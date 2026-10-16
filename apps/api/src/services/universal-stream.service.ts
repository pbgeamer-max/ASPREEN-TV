import * as fs from 'fs';
import * as path from 'path';

export interface UniversalStreamServer {
  id: string;
  name: string;
  url: string;
  isEmbed: boolean;
  quality?: string;
  isDefault?: boolean;
}

export class UniversalStreamService {
  private static instance: UniversalStreamService;
  private tmdbCache: Record<string, { id: number; type: 'movie' | 'tv' }> = {};
  private cachePath: string;
  private readonly TMDB_KEY = '4e44d9029b1270a757cddc766a1bcb63';

  private constructor() {
    this.cachePath = path.join(process.cwd(), 'data', 'tmdb_id_cache.json');
    this.loadCache();
  }

  public static getInstance(): UniversalStreamService {
    if (!UniversalStreamService.instance) {
      UniversalStreamService.instance = new UniversalStreamService();
    }
    return UniversalStreamService.instance;
  }

  private loadCache(): void {
    const candidates = [
      this.cachePath,
      path.join(process.cwd(), '..', '..', 'data', 'tmdb_id_cache.json'),
      path.join(__dirname, '..', '..', 'data', 'tmdb_id_cache.json'),
      path.join(__dirname, '..', '..', '..', 'data', 'tmdb_id_cache.json'),
      '/app/data/tmdb_id_cache.json',
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) {
        try {
          this.tmdbCache = JSON.parse(fs.readFileSync(c, 'utf8'));
          this.cachePath = c;
          return;
        } catch {}
      }
    }
  }

  private saveCache(): void {
    try {
      const dir = path.dirname(this.cachePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.cachePath, JSON.stringify(this.tmdbCache, null, 2), 'utf8');
    } catch {}
  }

  public cleanTitle(raw: string): string {
    return (raw || '')
      .replace(/\([0-9]{4}\)/g, '')
      .replace(/season\s*[0-9]+/gi, '')
      .replace(/الموسم\s*[0-9]+/gi, '')
      .replace(/part\s*[0-9]+/gi, '')
      .replace(/الجزء\s*[0-9]+/gi, '')
      .replace(/[-_:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  public detectSeason(raw: string): number {
    const sMatch =
      (raw || '').match(/season\s*([0-9]+)/i) ||
      (raw || '').match(/الموسم\s*([0-9]+)/i) ||
      (raw || '').match(/part\s*([0-9]+)/i) ||
      (raw || '').match(/الجزء\s*([0-9]+)/i);
    if (sMatch && sMatch[1]) {
      return parseInt(sMatch[1], 10);
    }
    const trailMatch = (raw || '').match(/\s+([2-9])$/);
    if (trailMatch && trailMatch[1]) {
      return parseInt(trailMatch[1], 10);
    }
    return 1;
  }

  public async resolveTmdb(
    title: string,
    year?: string,
    isMovie = false
  ): Promise<{ id: number; type: 'movie' | 'tv' } | null> {
    const clean = this.cleanTitle(title);
    const cacheKey = `${clean.toLowerCase()}_${isMovie ? 'm' : 't'}`;

    if (this.tmdbCache[cacheKey]) {
      return this.tmdbCache[cacheKey];
    }

    try {
      const endpoint = isMovie ? 'movie' : 'tv';
      let url = `https://api.themoviedb.org/3/search/${endpoint}?api_key=${this.TMDB_KEY}&query=${encodeURIComponent(clean)}`;
      if (year && /^[0-9]{4}$/.test(year)) {
        url += isMovie ? `&year=${year}` : `&first_air_date_year=${year}`;
      }

      let res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      let data = await res.json();

      let match: any = null;
      if (Array.isArray(data.results) && data.results.length > 0) {
        // Find best match: prioritize exact title match or Asian original languages
        const exact = data.results.find(
          (r: any) => (r.name || r.title || '').toLowerCase() === clean.toLowerCase()
        );
        const asian = data.results.find(
          (r: any) => ['ko', 'zh', 'ja', 'th'].includes(r.original_language)
        );
        match = exact || asian || data.results[0];
      }

      // If not found as movie/tv, try multi search fallback
      if (!match) {
        const multiUrl = `https://api.themoviedb.org/3/search/multi?api_key=${this.TMDB_KEY}&query=${encodeURIComponent(clean)}`;
        res = await fetch(multiUrl, { signal: AbortSignal.timeout(5000) });
        data = await res.json();
        if (Array.isArray(data.results) && data.results.length > 0) {
          match = data.results.find((r: any) => r.media_type === 'movie' || r.media_type === 'tv') || data.results[0];
        }
      }

      if (match && match.id) {
        const resolvedType = (match.media_type === 'movie' || isMovie) ? 'movie' : 'tv';
        const result = { id: match.id, type: resolvedType as 'movie' | 'tv' };
        this.tmdbCache[cacheKey] = result;
        this.saveCache();
        return result;
      }
    } catch (e: any) {
      console.warn('[UniversalStream] TMDB lookup error:', e.message);
    }

    return null;
  }

  public async getServersForEpisode(params: {
    title: string;
    episodeNumber: number;
    seasonNumber?: number;
    year?: string;
    isMovie?: boolean;
    vipStreamUrl?: string | null;
    backupUrl?: string | null;
  }): Promise<UniversalStreamServer[]> {
    const servers: UniversalStreamServer[] = [];
    const season = params.seasonNumber || this.detectSeason(params.title);
    const ep = params.episodeNumber || 1;
    const isMovie = Boolean(params.isMovie);

    // 1. VIP HLS Rebroadcast Server (if cached and active)
    if (params.vipStreamUrl) {
      servers.push({
        id: 'vip',
        name: 'سيرفر VIP فائق السرعة',
        url: params.vipStreamUrl,
        isEmbed: false,
        quality: '1080p',
        isDefault: true,
      });
    }

    // 2. Direct Third-Party Backup Embed (if available from scraper)
    if (params.backupUrl) {
      servers.push({
        id: 'backup-embed',
        name: 'سيرفر بديل مباشر',
        url: params.backupUrl,
        isEmbed: true,
        quality: 'HD',
        isDefault: servers.length === 0,
      });
    }

    // 3. Resolve Universal Embed Providers via TMDB
    const tmdb = await this.resolveTmdb(params.title, params.year, isMovie);

    if (tmdb && tmdb.id) {
      const id = tmdb.id;
      const isFilm = tmdb.type === 'movie';

      // Server A: VidLink Pro (Fast, modern, zero ad popups)
      const vidlinkUrl = isFilm
        ? `https://vidlink.pro/movie/${id}?primaryColor=E50914&secondaryColor=A1A1AA`
        : `https://vidlink.pro/tv/${id}/${season}/${ep}?primaryColor=E50914&secondaryColor=A1A1AA`;
      servers.push({
        id: 'vidlink',
        name: 'سيرفر VidLink Pro (سريع وعالي الدقة)',
        url: vidlinkUrl,
        isEmbed: true,
        quality: '1080p',
        isDefault: servers.length === 0,
      });

      // Server B: SuperEmbed Multi (Multi-server CDN: UpCloud, VidCloud, MixDrop, Streamwish)
      const superUrl = isFilm
        ? `https://multiembed.mov/?video_id=${id}&tmdb=1`
        : `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${season}&e=${ep}`;
      servers.push({
        id: 'superembed',
        name: 'سيرفر SuperEmbed (متعدد السيرفرات والجودات)',
        url: superUrl,
        isEmbed: true,
        quality: 'Multi-CDN',
        isDefault: servers.length === 0,
      });

      // Server C: VidSrc Global (Massive global library)
      const vidsrcUrl = isFilm
        ? `https://vidsrc.to/embed/movie/${id}`
        : `https://vidsrc.to/embed/tv/${id}/${season}/${ep}`;
      servers.push({
        id: 'vidsrc',
        name: 'سيرفر VidSrc العالمي',
        url: vidsrcUrl,
        isEmbed: true,
        quality: 'HD',
        isDefault: servers.length === 0,
      });

      // Server D: 2Embed Backup
      const twoEmbedUrl = isFilm
        ? `https://www.2embed.cc/embed/${id}`
        : `https://www.2embed.cc/embedtv/${id}&s=${season}&e=${ep}`;
      servers.push({
        id: 'twoembed',
        name: 'سيرفر 2Embed الاحتياطي',
        url: twoEmbedUrl,
        isEmbed: true,
        quality: 'HD',
      });
    }

    return servers;
  }
}

export const universalStreamService = UniversalStreamService.getInstance();
