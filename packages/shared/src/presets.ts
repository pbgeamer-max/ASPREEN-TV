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
  proxyUrl?: string;
  startNumber?: number;
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
  args.push('-protocol_whitelist', 'file,crypto,data,http,https,tcp,tls,pipe');

  // Resilient stream input flags to prevent aborts on network jitter, stream resets, and corrupted frames
  args.push('-fflags', '+genpts+discardcorrupt+igndts');
  args.push('-err_detect', 'ignore_err');

  if (params.inputUrl === 'pipe:0') {
    args.push('-probesize', '2000000');
    args.push('-analyzeduration', '3000000');
    args.push('-merge_pmt_versions', '1');
    args.push('-resync_size', '4194304');
    args.push('-f', 'mpegts');
    args.push('-i', 'pipe:0');
  } else {
    // Optional HTTP/SOCKS5 proxy for bypassing datacenter / geo-blocking
    if (params.proxyUrl) {
      args.push('-http_proxy', params.proxyUrl);
    }

    // Parse pipe headers syntax: url|Referer=...&Origin=... or url|Referer=...|Origin=...
    let actualInputUrl = params.inputUrl;
    const effectiveHeaders: Record<string, string> = { ...(params.customHeaders || {}) };

    if (actualInputUrl.includes('|')) {
      const pipeIdx = actualInputUrl.indexOf('|');
      const headerPart = actualInputUrl.substring(pipeIdx + 1);
      actualInputUrl = actualInputUrl.substring(0, pipeIdx);

      // Robustly split on both '|' and '&' delimiters
      const pairs = headerPart.split(/[|&]/);
      for (const pair of pairs) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx !== -1) {
          const key = pair.substring(0, eqIdx).trim();
          const val = pair.substring(eqIdx + 1).trim();
          if (key && val) {
            effectiveHeaders[key] = val;
          }
        }
      }
    }

    const DEFAULT_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

    // Auto-detect upstream requirements based on target host or stream origin
    const isCuttingFame = /cuttingfame/i.test(actualInputUrl) || (effectiveHeaders['Referer'] && /cuttingfame/i.test(effectiveHeaders['Referer']));
    const isLastVelvetCdn = 
      /:8443(?:\/hls\/|$)/i.test(actualInputUrl) ||
      /\.net:8443/i.test(actualInputUrl) ||
      /lastvelvet|cuttingfame|5gkygx509kqv|awqb0f40a9yo|7odxv0l067ka/i.test(actualInputUrl) ||
      (effectiveHeaders['Referer'] && /lastvelvet|cuttingfame/i.test(effectiveHeaders['Referer']));

    if (isCuttingFame) {
      effectiveHeaders['Referer'] = 'https://cuttingfame.net/';
      effectiveHeaders['Origin'] = 'https://cuttingfame.net';
      effectiveHeaders['User-Agent'] = DEFAULT_BROWSER_UA;
    } else if (isLastVelvetCdn) {
      if (!effectiveHeaders['Referer'] || /baranewssumsel|alokalive/i.test(effectiveHeaders['Referer'])) {
        effectiveHeaders['Referer'] = 'https://lastvelvet.net/';
      }
      effectiveHeaders['Origin'] = 'https://lastvelvet.net';
      effectiveHeaders['User-Agent'] = DEFAULT_BROWSER_UA;
    } else if (/baranewssumsel|sportsurges|alokalive/i.test(actualInputUrl) || (effectiveHeaders['Referer'] && /alokalive/i.test(effectiveHeaders['Referer']))) {
      if (!effectiveHeaders['Referer']) effectiveHeaders['Referer'] = 'https://www.alokalive.com/';
      if (!effectiveHeaders['Origin']) effectiveHeaders['Origin'] = 'https://www.alokalive.com';
      if (!effectiveHeaders['User-Agent']) effectiveHeaders['User-Agent'] = DEFAULT_BROWSER_UA;
    } else if (effectiveHeaders['Referer'] && !effectiveHeaders['Origin']) {
      try {
        const refUrl = new URL(effectiveHeaders['Referer']);
        effectiveHeaders['Origin'] = refUrl.origin;
      } catch {}
    }

    // Input reconnect flags and modern Chrome User-Agent for network HTTP/HTTPS streams
    if (/^https?:\/\//i.test(actualInputUrl)) {
      args.push('-user_agent', effectiveHeaders['User-Agent'] || DEFAULT_BROWSER_UA);
      // Suppress icy metadata and non-seekable to prevent HTTP 403 from CDN servers
      args.push('-icy', '0');
      args.push('-seekable', '0');
      args.push('-multiple_requests', '1');

      let headersStr = 'Connection: keep-alive\r\n';
      for (const [k, v] of Object.entries(effectiveHeaders)) {
        const lower = k.toLowerCase();
        if (lower !== 'user-agent' && lower !== 'pageurl') {
          headersStr += `${k}: ${v}\r\n`;
        }
      }
      args.push('-headers', headersStr);
      args.push('-reconnect', '1');
      args.push('-reconnect_delay_max', '2');

      const isHls = /\.m3u8(?:[?#]|$)/i.test(actualInputUrl);
      if (!isHls) {
        // -reconnect_at_eof and -reconnect_streamed are ONLY for infinite MPEG-TS streams.
        // On HLS playlists, reconnect_at_eof causes infinite loops at the end of the playlist file!
        args.push('-reconnect_at_eof', '1');
        args.push('-reconnect_streamed', '1');
      }

      args.push('-rw_timeout', '15000000');
      args.push('-timeout', '10000000');
    } else if (Object.keys(effectiveHeaders).length > 0) {
      const headersStr = Object.entries(effectiveHeaders)
        .filter(([k]) => k.toLowerCase() !== 'user-agent' && k.toLowerCase() !== 'pageurl')
        .map(([k, v]) => `${k}: ${v}\r\n`)
        .join('');
      if (headersStr) {
        args.push('-headers', headersStr);
      }
    }

    // Optimize probe size and analyze duration for fast live stream startup
    args.push('-probesize', '1000000');
    args.push('-analyzeduration', '1000000');

    // Input file / stream URL
    args.push('-i', actualInputUrl);
  }

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

  if (params.startNumber && params.startNumber > 0) {
    args.push('-start_number', params.startNumber.toString());
  }

  // HLS Multiplexer settings for true continuous 24/7 LIVE streaming:
  // - append_list: appends new segments to existing playlist upon auto-recovery without resetting sequence
  // - delete_segments: automatically purges expired .ts files from disk
  // - omit_endlist: NEVER writes #EXT-X-ENDLIST so players treat stream as perpetual live
  // - temp_file: atomic playlist and segment writes via temporary files (prevents corrupt reads)
  // - independent_segments: ensures each segment is independently decodable
  args.push('-f', 'hls');
  args.push('-hls_time', params.segmentDuration.toString());
  args.push('-hls_list_size', params.playlistWindow.toString());
  args.push('-hls_flags', 'append_list+delete_segments+omit_endlist+temp_file+independent_segments');
  args.push('-hls_segment_type', 'mpegts');

  // Normalized path separator for segments and playlist
  const normalizedOutputDir = params.outputDir.replace(/\\/g, '/').replace(/\/$/, '');
  const segmentPattern = `${normalizedOutputDir}/segment_%04d.ts`;
  const playlistPath = `${normalizedOutputDir}/index.m3u8`;

  args.push('-hls_segment_filename', segmentPattern);
  args.push(playlistPath);

  return args;
}
