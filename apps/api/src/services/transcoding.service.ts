import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn, ChildProcess } from 'child_process';
import * as crypto from 'crypto';
import {
  TranscodingJob,
  TranscodingPresetId,
  buildFfmpegArgs,
  TRANSCODING_PRESETS,
  BulkStartResult,
  BulkStopResult,
} from '@aspreen/shared';
import { channelRepository } from '../repositories/channel.repository';
import { jobRepository } from '../repositories/job.repository';
import { settingsRepository } from '../repositories/settings.repository';
import { logRepository } from '../repositories/log.repository';
import { decrypt } from '../security/encryption';
import { config } from '../config';

interface RunningProcess {
  process: ChildProcess;
  jobId: string;
  channelId: string;
  outputDir: string;
  heartbeatInterval: NodeJS.Timeout;
}

interface SpawnWorkerParams {
  channel: any;
  job: TranscodingJob;
  outputDir: string;
  outputDirectoryId: string;
  presetId: TranscodingPresetId;
  segmentDuration: number;
  playlistWindow: number;
  rawInputUrl: string;
  proxyUrl?: string;
}

export class TranscodingService {
  private activeProcesses: Map<string, RunningProcess> = new Map(); // jobId -> RunningProcess
  private intentionalStops: Set<string> = new Set(); // channelId
  private restartAttempts: Map<string, number> = new Map(); // channelId -> count
  private restartTimers: Map<string, NodeJS.Timeout> = new Map(); // channelId -> timer
  private lastAccessTimestamps: Map<string, number> = new Map(); // channelId -> timestamp
  private idleCheckInterval: NodeJS.Timeout;

  constructor() {
    this.idleCheckInterval = setInterval(() => {
      const now = Date.now();
      const IDLE_TIMEOUT_MS = 90000; // 90 seconds of inactivity
      for (const [_, running] of this.activeProcesses) {
        const lastAccess = this.lastAccessTimestamps.get(running.channelId);
        if (lastAccess && now - lastAccess > IDLE_TIMEOUT_MS) {
          console.log(`[Auto-Idle] Stopping inactive channel "${running.channelId}" after 90s idle.`);
          this.stopChannel(running.channelId).catch(() => {});
        }
      }
    }, 30000);
    this.idleCheckInterval.unref();
  }

  touchChannelAccess(channelId: string) {
    this.lastAccessTimestamps.set(channelId, Date.now());
  }

  async ensureChannelRunning(channelId: string): Promise<TranscodingJob | null> {
    this.touchChannelAccess(channelId);
    const existing = await jobRepository.getActiveJobForChannel(channelId);
    if (existing && (existing.status === 'RUNNING' || existing.status === 'STARTING')) {
      return existing;
    }
    try {
      return await this.startChannel(channelId, { preset: 'COPY' });
    } catch {
      return null;
    }
  }

  /**
   * Starts transcoding for a channel.
   */
  async startChannel(
    channelId: string,
    options: {
      preset?: TranscodingPresetId;
      segmentDuration?: number;
      playlistWindow?: number;
      ignoreConcurrencyLimit?: boolean;
    } = {}
  ): Promise<TranscodingJob> {
    const channel = await channelRepository.getChannel(channelId);
    if (!channel) throw new Error('Channel not found');

    // 1. Prevent duplicate active jobs for the same channel
    const existingJob = await jobRepository.getActiveJobForChannel(channelId);
    if (existingJob) {
      return existingJob;
    }

    // 2. Check concurrency limit
    const settings = await settingsRepository.getSettings();
    const presetId = options.preset || channel.preset || settings.defaultTranscodingPreset;
    const isCopyPreset = presetId === 'COPY';
    const concurrencyLimit = isCopyPreset || options.ignoreConcurrencyLimit ? 2500 : (settings.maxConcurrentJobs || 1000);

    const activeJobs = await jobRepository.listActiveJobs();
    if (activeJobs.length >= concurrencyLimit) {
      throw new Error(`Maximum concurrent transcoding jobs (${concurrencyLimit}) reached.`);
    }

    // Clear any previous intentional stop or pending restart timer
    this.intentionalStops.delete(channelId);
    this.restartAttempts.delete(channelId);
    const existingTimer = this.restartTimers.get(channelId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.restartTimers.delete(channelId);
    }

    // 3. Configure presets & HLS parameters
    const segmentDuration = options.segmentDuration || settings.defaultSegmentDuration || 4;
    const playlistWindow = options.playlistWindow || Math.max(8, settings.defaultPlaylistWindow || 8);
    const presetConfig = TRANSCODING_PRESETS[presetId];

    // 4. Create unique public output ID and filesystem directory
    const outputDirectoryId = channel.activeOutputId || crypto.randomBytes(8).toString('hex');
    const outputDir = path.resolve(config.streamStoragePath, outputDirectoryId);
    await fs.mkdir(outputDir, { recursive: true });

    // Clean out any stale segments or old playlists from previous runs
    try {
      const existingFiles = await fs.readdir(outputDir);
      for (const file of existingFiles) {
        if (file.endsWith('.ts') || file.endsWith('.m3u8') || file.endsWith('.tmp')) {
          await fs.unlink(path.join(outputDir, file)).catch(() => {});
        }
      }
    } catch {}

    // 5. Decrypt input URL
    const rawInputUrl = decrypt(channel.encryptedInputUrl);
    if (!rawInputUrl) {
      throw new Error('Channel input URL could not be decrypted');
    }

    // 6. Create Job record in Firestore
    const job = await jobRepository.createJob({
      channelId: channel.id,
      sourceId: channel.sourceId,
      status: 'STARTING',
      preset: presetId,
      validatedConfiguration: {
        segmentDuration,
        playlistWindow,
        videoCodec: presetConfig.videoCodec,
        audioCodec: presetConfig.audioCodec,
        scale: presetConfig.scale,
        bitrate: presetConfig.videoBitrate,
      },
      outputDirectoryId,
      queuedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
    });

    // 7. Update channel with active job and output ID
    await channelRepository.updateChannel(channel.id, {
      transcodingStatus: 'RUNNING',
      activeJobId: job.id,
      activeOutputId: outputDirectoryId,
      preset: presetId,
    });

    const proxyUrl = channel.proxyUrl || settings.defaultProxyUrl || 'http://avxkxvqi:kfq49mj05vbr@31.59.20.176:6754';

    // 8. Spawn FFmpeg process with supervisor
    try {
      await this.spawnFfmpegWorker({
        channel,
        job,
        outputDir,
        outputDirectoryId,
        presetId,
        segmentDuration,
        playlistWindow,
        rawInputUrl,
        proxyUrl,
      });

      await logRepository.addLog({
        eventType: 'JOB_STARTED',
        entityType: 'JOB',
        entityId: job.id,
        result: 'SUCCESS',
        safeDetails: {
          channelId: channel.id,
          channelName: channel.name,
          preset: presetId,
          outputId: outputDirectoryId,
        },
      });

      return job;
    } catch (err: any) {
      await jobRepository.updateJob(job.id, {
        status: 'FAILED',
        sanitizedErrorMessage: err.message,
      });
      await channelRepository.updateChannel(channel.id, {
        transcodingStatus: 'FAILED',
        activeJobId: undefined,
      });
      throw err;
    }
  }

  /**
   * Spawns an FFmpeg worker process with resilience, heartbeat, and auto-healing supervision.
   */
  private async spawnFfmpegWorker(params: SpawnWorkerParams) {
    const { channel, job, outputDir, presetId, segmentDuration, playlistWindow, rawInputUrl, proxyUrl } = params;

    // Clean any orphaned *.tmp files from previous killed run so they don't block new segments
    try {
      const files = await fs.readdir(outputDir);
      for (const f of files) {
        if (f.endsWith('.tmp')) {
          await fs.unlink(path.join(outputDir, f)).catch(() => {});
        }
      }
    } catch {}

    // Check if index.m3u8 already exists on disk
    const playlistPath = path.join(outputDir, 'index.m3u8');
    const playlistExists = await fs.access(playlistPath).then(() => true).catch(() => false);

    // When index.m3u8 exists, FFmpeg's append_list automatically resumes the segment sequence
    // monotonically from the last segment in the playlist. Passing startNumber alongside append_list
    // causes double-offsetting and segment skips. We only supply startNumber if index.m3u8 is missing
    // but segments already exist on disk.
    let startNumber: number | undefined = undefined;
    if (!playlistExists) {
      try {
        const files = await fs.readdir(outputDir);
        for (const f of files) {
          const m = f.match(/segment_(\d+)\.ts/);
          if (m) {
            const num = parseInt(m[1], 10);
            if (startNumber === undefined || num >= startNumber) startNumber = num + 1;
          }
        }
      } catch {}
    }

    const ffmpegArgs = buildFfmpegArgs({
      inputUrl: rawInputUrl,
      presetId,
      segmentDuration,
      playlistWindow,
      outputDir,
      proxyUrl,
      startNumber,
    });

    const child = spawn('ffmpeg', ffmpegArgs, {
      windowsHide: true,
    });

    // Heartbeat updater to Firestore
    const heartbeatInterval = setInterval(async () => {
      try {
        await jobRepository.updateJob(job.id, {
          lastHeartbeatAt: new Date().toISOString(),
        });
      } catch {
        // Ignore periodic heartbeat failure
      }
    }, 10000);

    // If stream runs stably for 25 seconds, reset restart attempt counter
    const healthyTimer = setTimeout(() => {
      if (this.activeProcesses.has(job.id)) {
        this.restartAttempts.delete(channel.id);
      }
    }, 25000);

    this.activeProcesses.set(job.id, {
      process: child,
      jobId: job.id,
      channelId: channel.id,
      outputDir,
      heartbeatInterval,
    });

    await jobRepository.updateJob(job.id, {
      status: 'RUNNING',
      processId: child.pid,
    });

    let stderrData = '';
    child.stderr?.on('data', (chunk) => {
      stderrData += chunk.toString();
      if (stderrData.length > 5000) {
        stderrData = stderrData.slice(-3000);
      }
    });

    // Handle process exit
    child.on('close', async (code) => {
      clearInterval(heartbeatInterval);
      clearTimeout(healthyTimer);
      this.activeProcesses.delete(job.id);

      const isIntentional = this.intentionalStops.has(channel.id);
      const safeError = stderrData ? stderrData.replace(/https?:\/\/[^\s]+/g, '[REDACTED_URL]').trim() : undefined;

      if (isIntentional) {
        // Intentional stop requested by user
        this.intentionalStops.delete(channel.id);
        this.restartAttempts.delete(channel.id);

        await jobRepository.updateJob(job.id, {
          status: 'STOPPED',
          stoppedAt: new Date().toISOString(),
          lastErrorCode: code !== null ? `EXIT_${code}` : 'KILLED',
        });

        await channelRepository.updateChannel(channel.id, {
          transcodingStatus: 'STOPPED',
          activeJobId: undefined,
        });

        await logRepository.addLog({
          eventType: 'JOB_STOPPED',
          entityType: 'JOB',
          entityId: job.id,
          result: 'SUCCESS',
          safeDetails: {
            channelId: channel.id,
            channelName: channel.name,
            exitCode: code,
            finalStatus: 'STOPPED',
          },
        });
        return;
      }

      // STREAM HEALING & AUTO-RECOVERY:
      // Upstream stream refreshed, reset socket, or suffered network drop.
      const attempts = (this.restartAttempts.get(channel.id) || 0) + 1;
      this.restartAttempts.set(channel.id, attempts);
      const MAX_AUTO_RESTARTS = 50;

      const isRateLimited = !!(safeError && (safeError.includes('429') || safeError.includes('Connection limit reached')));
      const delayMs = isRateLimited ? 5000 : 300;

      if (attempts <= MAX_AUTO_RESTARTS) {
        console.warn(`[Stream Healing] Channel "${channel.name}" (${channel.id}) dropped (code ${code}). Auto-recovering in ${delayMs}ms (Attempt ${attempts}/${MAX_AUTO_RESTARTS})...`);
        if (isRateLimited) {
          console.warn(`[Stream Warning] IPTV Provider returned HTTP 429 ("Connection limit reached"). Subscription credentials are in use by another connection. Waiting 5s before retrying...`);
        }
        if (stderrData) {
          console.error(`[Stream Error] FFmpeg stderr for "${channel.name}":\n${safeError || stderrData}`);
        }

        // Keep channel status as RUNNING in DB so downstream clients remain attached to HLS
        await channelRepository.updateChannel(channel.id, {
          transcodingStatus: 'RUNNING',
        });

        await logRepository.addLog({
          eventType: 'JOB_STOPPED',
          entityType: 'JOB',
          entityId: job.id,
          result: 'WARNING',
          safeDetails: {
            channelId: channel.id,
            channelName: channel.name,
            exitCode: code,
            note: isRateLimited 
              ? `IPTV Provider returned 429 (Connection limit reached). Retrying in 5s (Attempt ${attempts}/${MAX_AUTO_RESTARTS})...`
              : `Stream refreshed upstream. Auto-healing restart attempt ${attempts}/${MAX_AUTO_RESTARTS}...`,
            errorMessage: safeError ? safeError.slice(-150) : undefined,
          },
        });

        // Delay before re-spawning so the network / upstream has time to reconnect cleanly
        const timer = setTimeout(async () => {
          this.restartTimers.delete(channel.id);
          if (this.intentionalStops.has(channel.id)) return;

          try {
            await this.spawnFfmpegWorker(params);
          } catch (err: any) {
            console.error(`[Stream Healing] Failed to auto-recover channel ${channel.id}:`, err.message);
          }
        }, delayMs);

        this.restartTimers.set(channel.id, timer);
      } else {
        // Exceeded max recovery attempts
        this.restartAttempts.delete(channel.id);

        await jobRepository.updateJob(job.id, {
          status: 'FAILED',
          stoppedAt: new Date().toISOString(),
          lastErrorCode: code !== null ? `EXIT_${code}` : 'KILLED',
          sanitizedErrorMessage: safeError?.slice(-500) || 'Stream input connection failed or closed repeatedly',
        });

        await channelRepository.updateChannel(channel.id, {
          transcodingStatus: 'FAILED',
          activeJobId: undefined,
        });

        await logRepository.addLog({
          eventType: 'JOB_STOPPED',
          entityType: 'JOB',
          entityId: job.id,
          result: 'FAILURE',
          safeDetails: {
            channelId: channel.id,
            channelName: channel.name,
            exitCode: code,
            finalStatus: 'FAILED',
            note: 'Max auto-recovery attempts reached. Upstream stream appears permanently offline.',
            errorMessage: safeError ? safeError.slice(-200) : undefined,
          },
        });
      }
    });
  }

  /**
   * Stops an active transcoding job.
   */
  async stopChannel(channelId: string): Promise<boolean> {
    this.intentionalStops.add(channelId);
    this.restartAttempts.delete(channelId);
    const pendingTimer = this.restartTimers.get(channelId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.restartTimers.delete(channelId);
    }

    const channel = await channelRepository.getChannel(channelId);
    if (!channel) return false;

    const activeJob = await jobRepository.getActiveJobForChannel(channelId);
    if (!activeJob) {
      await channelRepository.updateChannel(channelId, {
        transcodingStatus: 'STOPPED',
        activeJobId: undefined,
      });
      return true;
    }

    const running = this.activeProcesses.get(activeJob.id);
    if (running) {
      clearInterval(running.heartbeatInterval);
      try {
        if (running.process.stdin && !running.process.stdin.destroyed) {
          try {
            running.process.stdin.end();
          } catch {}
        }
        running.process.kill('SIGTERM');
        // Force kill after 4 seconds if not exited
        setTimeout(() => {
          try {
            running.process.kill('SIGKILL');
          } catch {}
        }, 4000);
      } catch {}
      this.activeProcesses.delete(activeJob.id);
    }

    await jobRepository.updateJob(activeJob.id, {
      status: 'STOPPED',
      stoppedAt: new Date().toISOString(),
    });

    await channelRepository.updateChannel(channelId, {
      transcodingStatus: 'STOPPED',
      activeJobId: undefined,
    });

    return true;
  }

  /**
   * Stops a job directly by job ID.
   */
  async stopJob(jobId: string): Promise<boolean> {
    const job = await jobRepository.getJob(jobId);
    if (!job) return false;
    return this.stopChannel(job.channelId);
  }

  /**
   * Starts all enabled channels (or filtered by sourceId) using COPY preset.
   */
  async bulkStartChannels(options: {
    sourceId?: string;
    preset?: TranscodingPresetId;
    maxToStart?: number;
  } = {}): Promise<BulkStartResult> {
    const limit = options.maxToStart || 2500;
    const channels = await channelRepository.listChannels(options.sourceId, limit);
    const enabledChannels = channels.filter((c) => c.enabled !== false);

    let startedCount = 0;
    let alreadyRunningCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    const preset = options.preset || 'COPY';

    // Process in batches of 15 for fast parallel initialization
    const BATCH_SIZE = 15;
    for (let i = 0; i < enabledChannels.length; i += BATCH_SIZE) {
      const batch = enabledChannels.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (ch) => {
          if (ch.transcodingStatus === 'RUNNING' && ch.activeJobId) {
            alreadyRunningCount++;
            return;
          }
          try {
            await this.startChannel(ch.id, { preset, ignoreConcurrencyLimit: true });
            startedCount++;
          } catch (err: any) {
            errors.push(`Channel "${ch.name}": ${err.message}`);
          }
        })
      );
    }

    await logRepository.addLog({
      eventType: 'BULK_CHANNELS_STARTED',
      entityType: 'CHANNEL',
      result: errors.length > 0 && startedCount === 0 ? 'FAILURE' : 'SUCCESS',
      safeDetails: {
        sourceId: options.sourceId,
        totalTargeted: enabledChannels.length,
        startedCount,
        alreadyRunningCount,
        skippedCount,
        preset,
      },
    });

    return {
      totalTargeted: enabledChannels.length,
      startedCount,
      alreadyRunningCount,
      skippedCount,
      errors: errors.slice(0, 10),
    };
  }

  /**
   * Stops all active transcoding channels (or filtered by sourceId).
   */
  async bulkStopChannels(sourceId?: string): Promise<BulkStopResult> {
    const channels = await channelRepository.listChannels(sourceId, 5000);
    let stoppedCount = 0;

    const BATCH_SIZE = 25;
    for (let i = 0; i < channels.length; i += BATCH_SIZE) {
      const batch = channels.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (ch) => {
          if (ch.transcodingStatus === 'RUNNING' || ch.activeJobId) {
            const stopped = await this.stopChannel(ch.id);
            if (stopped) stoppedCount++;
          }
        })
      );
    }

    await logRepository.addLog({
      eventType: 'BULK_CHANNELS_STOPPED',
      entityType: 'CHANNEL',
      result: 'SUCCESS',
      safeDetails: {
        sourceId,
        stoppedCount,
      },
    });

    return { stoppedCount };
  }
}

export const transcodingService = new TranscodingService();
