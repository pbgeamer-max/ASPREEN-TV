import { spawn } from 'child_process';
import { StreamProbeInfo } from '@aspreen/shared';

/**
 * Inspects a remote or local stream using ffprobe with strict timeouts and argument arrays.
 */
export async function probeStream(streamUrl: string, timeoutMs: number = 8000): Promise<StreamProbeInfo> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      '-analyzeduration', '3000000',
      '-probesize', '3000000',
      '-protocol_whitelist', 'file,crypto,data,http,https,tcp,tls',
      streamUrl,
    ];

    let stdoutData = '';
    let stderrData = '';
    let isSettled = false;

    const proc = spawn('ffprobe', args, {
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        proc.kill('SIGKILL');
        reject(new Error(`Stream probe timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
    });

    proc.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    proc.on('error', (err) => {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(timer);
        reject(new Error(`Failed to execute ffprobe: ${err.message}`));
      }
    });

    proc.on('close', (code) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timer);

      if (code !== 0) {
        // Redact any URL parts from stderr for security
        const safeError = stderrData.replace(/https?:\/\/[^\s]+/g, '[URL]');
        return reject(new Error(`ffprobe failed with exit code ${code}: ${safeError || 'Unknown error'}`));
      }

      try {
        const parsed = JSON.parse(stdoutData);
        const format = parsed.format || {};
        const streams = parsed.streams || [];

        const videoStream = streams.find((s: any) => s.codec_type === 'video');
        const audioStream = streams.find((s: any) => s.codec_type === 'audio');

        const info: StreamProbeInfo = {
          formatName: format.format_name || 'unknown',
          duration: format.duration ? parseFloat(format.duration) : undefined,
          bitrate: format.bit_rate ? parseInt(format.bit_rate, 10) : undefined,
        };

        if (videoStream) {
          info.video = {
            codec: videoStream.codec_name || 'unknown',
            width: videoStream.width || 0,
            height: videoStream.height || 0,
            bitrate: videoStream.bit_rate ? parseInt(videoStream.bit_rate, 10) : undefined,
          };
        }

        if (audioStream) {
          info.audio = {
            codec: audioStream.codec_name || 'unknown',
            channels: audioStream.channels || 2,
            sampleRate: audioStream.sample_rate ? parseInt(audioStream.sample_rate, 10) : 48000,
            bitrate: audioStream.bit_rate ? parseInt(audioStream.bit_rate, 10) : undefined,
          };
        }

        resolve(info);
      } catch (parseErr: any) {
        reject(new Error(`Failed to parse ffprobe JSON output: ${parseErr.message}`));
      }
    });
  });
}
