import { TranscodingPresetId } from './types';

export interface TranscodingPresetConfig {
  id: TranscodingPresetId;
  name: string;
  description: string;
  videoCodec: string;
  audioCodec: string;
  videoBitrate?: string;
  audioBitrate?: string;
  scale?: string;
  cpuPreset?: string;
}

export const TRANSCODING_PRESETS: Record<TranscodingPresetId, TranscodingPresetConfig> = {
  COPY: {
    id: 'COPY',
    name: 'Compatible Stream Copy',
    description: 'Copies audio and video streams directly without re-encoding (minimal CPU, source codecs must be H.264/AAC for HLS compatibility).',
    videoCodec: 'copy',
    audioCodec: 'copy',
  },
  SOURCE_RES: {
    id: 'SOURCE_RES',
    name: 'H.264 + AAC — Source Resolution',
    description: 'Re-encodes video to standard H.264 and audio to AAC while preserving the input resolution and aspect ratio.',
    videoCodec: 'libx264',
    audioCodec: 'aac',
    audioBitrate: '128k',
    cpuPreset: 'veryfast',
  },
  '720P': {
    id: '720P',
    name: 'H.264 + AAC — 720p',
    description: 'Transcodes video to 720p (1280x720) at 2500 kbps and audio to stereo AAC at 128 kbps. Ideal for balanced bandwidth.',
    videoCodec: 'libx264',
    audioCodec: 'aac',
    videoBitrate: '2500k',
    audioBitrate: '128k',
    scale: 'scale=-2:720',
    cpuPreset: 'veryfast',
  },
  '1080P': {
    id: '1080P',
    name: 'H.264 + AAC — 1080p',
    description: 'Transcodes video to 1080p (1920x1080) at 5000 kbps and audio to high-fidelity AAC at 192 kbps. Highest quality.',
    videoCodec: 'libx264',
    audioCodec: 'aac',
    videoBitrate: '5000k',
    audioBitrate: '192k',
    scale: 'scale=-2:1080',
    cpuPreset: 'veryfast',
  },
};

export interface HlsBuildParams {
  inputUrl: string;
  presetId: TranscodingPresetId;
  segmentDuration: number;
  playlistWindow: number;
  outputDir: string;
  customHeaders?: Record<string, string>;
}

/**
 * Builds safe argument array for spawning FFmpeg process.
 * Never interpolates strings into a shell!
 */
export function buildFfmpegArgs(params: HlsBuildParams): string[] {
  const preset = TRANSCODING_PRESETS[params.presetId] || TRANSCODING_PRESETS.COPY;
  const args: string[] = [];

  // Hide banner, log level
  args.push('-hide_banner');
  args.push('-loglevel', 'warning');

  // Strict protocol whitelist to prevent SSRF/local file disclosure inside FFmpeg
  args.push('-protocol_whitelist', 'file,crypto,data,http,https,tcp,tls');

  // Resilient stream input flags to prevent aborts on network jitter, stream resets, and corrupted frames
  args.push('-fflags', '+genpts+discardcorrupt+nobuffer');
  args.push('-err_detect', 'ignore_err');

  // Input reconnect flags for resilient stream reading (only for network HTTP/HTTPS streams)
  if (/^https?:\/\//i.test(params.inputUrl)) {
    args.push('-reconnect', '1');
    args.push('-reconnect_at_eof', '1');
    args.push('-reconnect_streamed', '1');
    args.push('-reconnect_delay_max', '2');
    args.push('-rw_timeout', '10000000');
  }

  // Custom HTTP headers if provided
  if (params.customHeaders && Object.keys(params.customHeaders).length > 0) {
    const headersStr = Object.entries(params.customHeaders)
      .map(([k, v]) => `${k}: ${v}\r\n`)
      .join('');
    args.push('-headers', headersStr);
  }

  // Input file / stream URL
  args.push('-i', params.inputUrl);

  // Avoid negative timestamps when upstream resets or refreshes
  args.push('-avoid_negative_ts', 'make_zero');

  // Video & Audio Encoding parameters
  if (preset.id === 'COPY') {
    args.push('-c:v', 'copy');
    args.push('-c:a', 'copy');
  } else {
    args.push('-c:v', preset.videoCodec);
    if (preset.scale) {
      args.push('-vf', preset.scale);
    }
    if (preset.cpuPreset) {
      args.push('-preset', preset.cpuPreset);
    }
    if (preset.videoBitrate) {
      args.push('-b:v', preset.videoBitrate);
      // Reasonable maxrate and bufsize for live HLS streaming
      const numericBitrate = parseInt(preset.videoBitrate.replace('k', ''), 10);
      if (!isNaN(numericBitrate)) {
        args.push('-maxrate', `${Math.round(numericBitrate * 1.15)}k`);
        args.push('-bufsize', `${Math.round(numericBitrate * 2)}k`);
      }
    }
    // Force periodic keyframes matching HLS segment duration for clean segment cuts
    const gopSize = Math.max(25, Math.round(params.segmentDuration * 30));
    args.push('-g', gopSize.toString());
    args.push('-keyint_min', gopSize.toString());
    args.push('-sc_threshold', '0');

    args.push('-c:a', preset.audioCodec);
    if (preset.audioBitrate) {
      args.push('-b:a', preset.audioBitrate);
    }
    args.push('-af', 'aresample=async=1000');
    args.push('-ar', '48000');
    args.push('-ac', '2');
  }

  // HLS Multiplexer settings
  args.push('-f', 'hls');
  args.push('-hls_time', params.segmentDuration.toString());
  args.push('-hls_list_size', params.playlistWindow.toString());
  args.push('-hls_flags', 'delete_segments+append_list+discont_start+independent_segments');
  args.push('-hls_segment_type', 'mpegts');

  // Normalized path separator for segments and playlist
  const normalizedOutputDir = params.outputDir.replace(/\\/g, '/').replace(/\/$/, '');
  const segmentPattern = `${normalizedOutputDir}/segment_%04d.ts`;
  const playlistPath = `${normalizedOutputDir}/index.m3u8`;

  args.push('-hls_segment_filename', segmentPattern);
  args.push(playlistPath);

  return args;
}
