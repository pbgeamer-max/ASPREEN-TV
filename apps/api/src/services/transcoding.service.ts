import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn, ChildProcess } from 'child_process';
import * as crypto from 'crypto';
import {
  TranscodingJob,
  TranscodingPresetId,
  buildFfmpegArgs,
  TRANSCODING_PRESETS,
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
  ffmpegArgs: string[];
  outputDir: string;
  outputDirectoryId: string;
  presetId: TranscodingPresetId;
  segmentDuration: number;
  playlistWindow: number;
  rawInputUrl: string;
}

export class TranscodingService {
  private activeProcesses: Map<string, RunningProcess> = new Map(); // jobId -> RunningProcess
  private intentionalStops: Set<string> = new Set(); // channelId
  private restartAttempts: Map<string, number> = new Map(); // channelId -> count
  private restartTimers: Map<string, NodeJS.Timeout> = new Map(); // channelId -> timer

  /**
   * Starts transcoding for a channel.
   */
  async startChannel(
    channelId: string,
    options: {
      preset?: TranscodingPresetId;
      segmentDuration?: number;
      playlistWindow?: number;
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
    const activeJobs = await jobRepository.listActiveJobs();
    if (activeJobs.length >= settings.maxConcurrentJobs) {
      throw new Error(`Maximum concurrent transcoding jobs (${settings.maxConcurrentJobs}) reached.`);
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
    const presetId = options.preset || channel.preset || settings.defaultTranscodingPreset;
    const segmentDuration = options.segmentDuration || settings.defaultSegmentDuration;
    const playlistWindow = options.playlistWindow || settings.defaultPlaylistWindow;
    const presetConfig = TRANSCODING_PRESETS[presetId];

    // 4. Create unique public output ID and filesystem directory
    const outputDirectoryId = channel.activeOutputId || crypto.randomBytes(8).toString('hex');
    const outputDir = path.resolve(config.streamStoragePath, outputDirectoryId);
    await fs.mkdir(outputDir, { recursive: true });

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

    // 8. Build FFmpeg arguments array
    const ffmpegArgs = buildFfmpegArgs({
      inputUrl: rawInputUrl,
      presetId,
      segmentDuration,
      playlistWindow,
      outputDir,
    });

    // 9. Spawn FFmpeg process with supervisor
    try {
      await this.spawnFfmpegWorker({
        channel,
        job,
        ffmpegArgs,
        outputDir,
        outputDirectoryId,
        presetId,
        segmentDuration,
        playlistWindow,
        rawInputUrl,
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
    const { channel, job, ffmpegArgs, outputDir, outputDirectoryId, presetId, segmentDuration, playlistWindow, rawInputUrl } = params;

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
      const isNormalStop = code === 0 || code === 255;
      const safeError = stderrData ? stderrData.replace(/https?:\/\/[^\s]+/g, '[REDACTED_URL]').trim() : undefined;

      if (isIntentional || isNormalStop) {
        // Intentional stop or clean exit requested
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

      if (attempts <= MAX_AUTO_RESTARTS) {
        console.warn(`[Stream Healing] Channel "${channel.name}" (${channel.id}) dropped (code ${code}). Auto-recovering in 2s (Attempt ${attempts}/${MAX_AUTO_RESTARTS})...`);
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
            note: `Stream refreshed or disconnected upstream. Auto-healing restart attempt ${attempts}/${MAX_AUTO_RESTARTS}...`,
            errorMessage: safeError ? safeError.slice(-150) : undefined,
          },
        });

        // Delay 2s before re-spawning so the network / upstream has time to reconnect
        const timer = setTimeout(async () => {
          this.restartTimers.delete(channel.id);
          if (this.intentionalStops.has(channel.id)) return;

          try {
            await this.spawnFfmpegWorker(params);
          } catch (err: any) {
            console.error(`[Stream Healing] Failed to auto-recover channel ${channel.id}:`, err.message);
          }
        }, 2000);

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
}

export const transcodingService = new TranscodingService();
