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

export class TranscodingService {
  private activeProcesses: Map<string, RunningProcess> = new Map(); // jobId -> RunningProcess

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

    // 9. Spawn FFmpeg process
    try {
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
        this.activeProcesses.delete(job.id);

        const isNormalStop = code === 0 || code === 255;
        const finalStatus = isNormalStop ? 'STOPPED' : 'FAILED';
        const safeError = stderrData ? stderrData.replace(/https?:\/\/[^\s]+/g, '[REDACTED_URL]').trim() : undefined;

        await jobRepository.updateJob(job.id, {
          status: finalStatus,
          stoppedAt: new Date().toISOString(),
          lastErrorCode: code !== null ? `EXIT_${code}` : 'KILLED',
          sanitizedErrorMessage: isNormalStop ? undefined : (safeError?.slice(-500) || 'Stream input connection failed or closed'),
        });

        await channelRepository.updateChannel(channel.id, {
          transcodingStatus: finalStatus,
          activeJobId: undefined,
        });

        await logRepository.addLog({
          eventType: 'JOB_STOPPED',
          entityType: 'JOB',
          entityId: job.id,
          result: isNormalStop ? 'SUCCESS' : 'WARNING',
          safeDetails: {
            channelId: channel.id,
            channelName: channel.name,
            exitCode: code,
            finalStatus,
            errorMessage: safeError ? safeError.slice(-200) : undefined,
          },
        });
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
   * Stops an active transcoding job.
   */
  async stopChannel(channelId: string): Promise<boolean> {
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
