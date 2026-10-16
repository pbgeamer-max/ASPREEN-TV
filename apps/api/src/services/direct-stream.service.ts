import nacl from './nacl';

export interface ExtractedStream {
  streamUrl: string;
  isDirectVideo: boolean;
  quality: string;
  subtitles: Array<{
    language: string;
    url: string;
    type: string;
    isArabic: boolean;
  }>;
  headers?: Record<string, string>;
}

export class DirectStreamService {
  private static instance: DirectStreamService;
  private readonly KEY_HEX = 'c75136c5668bbfe65a7ecad431a745db68b5f381555b38d8f6c699449cf11fcd';
  private key: Uint8Array;
  private nonce: Uint8Array;
  private cache = new Map<string, { data: ExtractedStream | null; expiresAt: number }>();

  private constructor() {
    this.key = new Uint8Array(Buffer.from(this.KEY_HEX, 'hex'));
    this.nonce = new Uint8Array(24);
  }

  public static getInstance(): DirectStreamService {
    if (!DirectStreamService.instance) {
      DirectStreamService.instance = new DirectStreamService();
    }
    return DirectStreamService.instance;
  }

  public encryptToken(mediaId: string): string {
    const timestamp = Math.floor(Date.now() / 1000) + 480;
    const tsBuf = Buffer.alloc(8);
    tsBuf.writeBigUInt64BE(BigInt(timestamp));
    const msg = Buffer.concat([Buffer.from(mediaId, 'utf8'), tsBuf]);
    const box = (nacl as any).secretbox(new Uint8Array(msg), this.nonce, this.key);
    const fullPayload = Buffer.concat([Buffer.from(this.nonce), Buffer.from(box)]);
    return fullPayload.toString('base64url');
  }

  public async getDirectStream(params: {
    tmdbId: string | number;
    season?: number;
    episode?: number;
    isMovie?: boolean;
  }): Promise<ExtractedStream | null> {
    const isMovie = Boolean(params.isMovie);
    const season = params.season || 1;
    const episode = params.episode || 1;
    const tmdbId = String(params.tmdbId);
    const cacheKey = `ds_${tmdbId}_${isMovie ? 'm' : `${season}_${episode}`}`;

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    try {
      const token = this.encryptToken(tmdbId);
      const url = isMovie
        ? `https://vidlink.pro/api/b/movie/${token}?multiLang=1`
        : `https://vidlink.pro/api/b/tv/${token}/${season}/${episode}?multiLang=1`;

      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
          Origin: 'https://vidlink.pro',
          Referer: 'https://vidlink.pro/',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        return null;
      }

      const data = await res.json();
      if (!data || !data.stream) {
        return null;
      }

      const stream = data.stream;
      const qualities = stream.qualities || {};

      // Pick highest available quality: 1080 > 720 > 480 > 360 > any
      let pickedQuality = '1080p';
      let pickedObj = qualities['1080'] || qualities['720'] || qualities['480'] || qualities['360'];

      if (!pickedObj) {
        const keys = Object.keys(qualities);
        if (keys.length > 0) {
          pickedObj = qualities[keys[0]];
          pickedQuality = `${keys[0]}p`;
        }
      }

      let rawVideoUrl = pickedObj?.url || stream.playlist || '';
      if (!rawVideoUrl) {
        return null;
      }

      // Parse captions/subtitles (especially Arabic!)
      const isArabicText = (str: string) => {
        if (!str) return false;
        const stripped = str.replace(/[\u064B-\u065F\u0670]/g, '').toLowerCase();
        return (
          stripped.includes('عرب') ||
          stripped.includes('arab') ||
          stripped === 'ar' ||
          stripped === 'ara'
        );
      };

      const rawCaptions = Array.isArray(stream.captions) ? stream.captions : [];
      const parsedSubtitles = rawCaptions
        .filter((c: any) => Boolean(c.url))
        .map((c: any) => {
          const lang = c.language || '';
          const isAr = isArabicText(lang);
          return {
            language: isAr ? 'العربية (Arabic)' : lang || 'Subtitle',
            url: c.url,
            type: c.type || 'srt',
            isArabic: isAr,
          };
        })
        // Sort Arabic to the very top so player activates it by default
        .sort((a: any, b: any) => (b.isArabic ? 1 : 0) - (a.isArabic ? 1 : 0));

      const result: ExtractedStream = {
        streamUrl: rawVideoUrl,
        isDirectVideo: true,
        quality: pickedQuality,
        subtitles: parsedSubtitles,
        headers: pickedObj?.headers || {
          referer: 'https://filmboom.top/',
          origin: 'https://filmboom.top',
        },
      };

      this.cache.set(cacheKey, {
        data: result,
        expiresAt: Date.now() + 60 * 60 * 1000, // cache 1 hour
      });

      return result;
    } catch (err: any) {
      console.warn('[DirectStream] Extraction error:', err.message);
      return null;
    }
  }
}

export const directStreamService = DirectStreamService.getInstance();
