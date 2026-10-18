import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { spawn } from 'child_process';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

export interface VodItem {
  id: string;
  slug: string;
  title: string;
  url: string;
  posterUrl: string | null;
  type: 'series' | 'movie';
  isDubbed: boolean;
  isSubbed: boolean;
}

export interface VodEpisode {
  id: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  url: string;
}

export interface VodSeason {
  seasonNumber: number;
  episodesCount: number;
  episodes: VodEpisode[];
}

export interface VodSeriesDetail extends VodItem {
  overview: string;
  seasonsCount: number;
  totalEpisodes: number;
  seasons: VodSeason[];
  updatedAt: number;
}

export interface ResolvedVodStream {
  success: boolean;
  targetUrl: string;
  title: string | null;
  hlsUrl: string | null;
  streamProxyUrl: string | null;
  embedUrl: string | null;
  playerUrl: string | null;
  cdnType: string | null;
  durationMs: number;
  error?: string;
}

export class VodService {
  private seriesList: VodItem[] = [];
  private moviesList: VodItem[] = [];
  private streamCache: Map<string, { data: ResolvedVodStream; expiresAt: number }> = new Map();
  private dataDir: string;
  private cacheDir: string;

  constructor() {
    this.dataDir = path.resolve(process.cwd(), 'data');
    this.cacheDir = path.resolve(this.dataDir, 'vod_cache');
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
    } catch {}
    this.loadCatalog();
  }

  private loadCatalog() {
    try {
      const seriesPath = path.resolve(this.dataDir, 'vod_series.json');
      if (fs.existsSync(seriesPath)) {
        this.seriesList = JSON.parse(fs.readFileSync(seriesPath, 'utf-8'));
      }
    } catch (e: any) {
      console.error('[VodService] Error loading vod_series.json:', e.message);
    }

    try {
      const moviesPath = path.resolve(this.dataDir, 'vod_movies.json');
      if (fs.existsSync(moviesPath)) {
        this.moviesList = JSON.parse(fs.readFileSync(moviesPath, 'utf-8'));
      }
    } catch (e: any) {
      console.error('[VodService] Error loading vod_movies.json:', e.message);
    }

    console.log(`[VodService] Catalog ready: ${this.seriesList.length} series, ${this.moviesList.length} movies`);
  }

  public getSeries(params: { page?: number; limit?: number; search?: string; filter?: string }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 24));
    let items = this.seriesList;

    if (params.filter === 'dubbed') {
      items = items.filter(s => s.isDubbed);
    } else if (params.filter === 'subbed') {
      items = items.filter(s => s.isSubbed);
    }

    if (params.search && params.search.trim()) {
      const q = params.search.trim().toLowerCase();
      items = items.filter(s => s.title.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q));
    }

    const total = items.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const paginated = items.slice(offset, offset + limit);

    return {
      success: true,
      total,
      page,
      limit,
      totalPages,
      series: paginated
    };
  }

  public getMovies(params: { page?: number; limit?: number; search?: string; filter?: string }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 24));
    let items = this.moviesList;

    if (params.filter === 'dubbed') {
      items = items.filter(m => m.isDubbed);
    } else if (params.filter === 'subbed') {
      items = items.filter(m => m.isSubbed);
    }

    if (params.search && params.search.trim()) {
      const q = params.search.trim().toLowerCase();
      items = items.filter(m => m.title.toLowerCase().includes(q) || m.slug.toLowerCase().includes(q));
    }

    const total = items.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const paginated = items.slice(offset, offset + limit);

    return {
      success: true,
      total,
      page,
      limit,
      totalPages,
      movies: paginated
    };
  }

  public async getSeriesDetail(slugOrUrl: string): Promise<VodSeriesDetail | null> {
    const slug = slugOrUrl.replace(/^https?:\/\/.*?\//, '').replace(/^watch\/tvshows\//, '').replace(/\/$/, '');
    const cacheFile = path.resolve(this.cacheDir, `series_${slug}.json`);

    if (fs.existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        if (cached && cached.seasons && cached.seasons.length > 0) {
          return cached;
        }
      } catch {}
    }

    // Dynamic on-demand scrape from 3isk
    const targetUrl = slugOrUrl.startsWith('http') ? slugOrUrl : `https://3iskk.xyz/watch/tvshows/${slug}/`;
    try {
      const html = await this.requestText(targetUrl);
      const titleM = html.match(/<h1[^>]*>(.*?)<\/h1>/s);
      const title = titleM ? titleM[1].replace(/<[^>]+>/g, '').trim() : slug;

      const posterM = html.match(/<div class="poster"[^>]*>.*?<img[^>]*src=["']([^"']+)["']/s);
      const posterUrl = posterM ? posterM[1] : null;

      const storyM = html.match(/<div[^>]*class=["'](?:wp-content|story)["'][^>]*>(.*?)<\/div>/s);
      const overview = storyM ? storyM[1].replace(/<[^>]+>/g, '').trim() : '';

      const rawEpisodes = html.match(/href=["'](https:\/\/3iskk\.xyz\/watch\/episodes\/[^"']+)["']/g) || [];
      const seasonsMap: { [key: number]: VodEpisode[] } = {};

      const seenUrls = new Set<string>();
      for (const item of rawEpisodes) {
        const epUrlM = item.match(/href=["'](https:\/\/3iskk\.xyz\/watch\/episodes\/[^"']+)["']/);
        if (!epUrlM) continue;
        const epUrl = epUrlM[1];
        if (seenUrls.has(epUrl)) continue;
        seenUrls.add(epUrl);

        const epSlug = epUrl.replace(/\/$/, '').split('/').pop() || '';
        let sNum = 1;
        let eNum = 1;
        const sMatch = epSlug.match(/season-(\d+)/);
        if (sMatch) sNum = parseInt(sMatch[1], 10);
        const eMatch = epSlug.match(/episode-(\d+)/);
        if (eMatch) eNum = parseInt(eMatch[1], 10);

        if (!seasonsMap[sNum]) seasonsMap[sNum] = [];
        seasonsMap[sNum].push({
          id: epSlug,
          seasonNumber: sNum,
          episodeNumber: eNum,
          title: `الحلقة ${eNum}`,
          url: epUrl,
        });
      }

      const sortedSeasons: VodSeason[] = Object.keys(seasonsMap)
        .map(Number)
        .sort((a, b) => a - b)
        .map(sNum => {
          const eps = seasonsMap[sNum].sort((a, b) => a.episodeNumber - b.episodeNumber);
          return {
            seasonNumber: sNum,
            episodesCount: eps.length,
            episodes: eps,
          };
        });

      const detail: VodSeriesDetail = {
        id: slug,
        slug,
        title,
        url: targetUrl,
        posterUrl,
        type: 'series',
        isDubbed: title.includes('مدبلج'),
        isSubbed: title.includes('مترجم'),
        overview,
        seasonsCount: sortedSeasons.length,
        totalEpisodes: sortedSeasons.reduce((sum, s) => sum + s.episodesCount, 0),
        seasons: sortedSeasons,
        updatedAt: Math.floor(Date.now() / 1000),
      };

      try {
        fs.writeFileSync(cacheFile, JSON.stringify(detail, null, 2), 'utf-8');
      } catch {}

      return detail;
    } catch (e: any) {
      console.error(`[VodService] Failed to scrape series detail for ${slug}:`, e.message);
      return null;
    }
  }

  public async resolveStream(targetUrlOrSlug: string, baseUrl: string = ''): Promise<ResolvedVodStream> {
    let targetUrl = targetUrlOrSlug;
    if (!targetUrl.startsWith('http')) {
      if (targetUrl.includes('movie-') || targetUrl.includes('film-')) {
        targetUrl = `https://3iskk.xyz/watch/movies/${targetUrl}/`;
      } else {
        targetUrl = `https://3iskk.xyz/watch/episodes/${targetUrl}/`;
      }
    }

    // Check memory cache (valid for 30 minutes)
    const cached = this.streamCache.get(targetUrl);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const t0 = Date.now();
    const result: ResolvedVodStream = {
      success: false,
      targetUrl,
      title: null,
      hlsUrl: null,
      streamProxyUrl: null,
      embedUrl: null,
      playerUrl: null,
      cdnType: null,
      durationMs: 0,
    };

    try {
      const epHtml = await this.requestText(targetUrl);
      const titleM = epHtml.match(/<h1[^>]*>(.*?)<\/h1>/s);
      if (titleM) {
        result.title = titleM[1].replace(/<[^>]+>/g, '').trim();
      }

      const form1Action = epHtml.match(/<form[^>]*action=["'](https:\/\/aa\.3isk\.icu\/[^"']+)["']/);
      const news1Val = epHtml.match(/<input[^>]*name=["']news["'][^>]*value=["']([^"']+)["']/);
      if (!form1Action || !news1Val) {
        throw new Error('Step 1 form not found on page');
      }

      const body1 = new URLSearchParams({ news: news1Val[1], submit: 'submit' }).toString();
      const s1Html = await this.requestText(form1Action[1], {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': targetUrl,
          'Origin': 'https://3iskk.xyz',
        },
        body: body1,
      });

      const myUrlM = s1Html.match(/var\s+myUrl\s*=\s*["']([^"']+)["']/);
      const myInputM = s1Html.match(/myInput\.value\s*=\s*["']([^"']+)["']/);

      let playerHtml = s1Html;
      if (myUrlM && myInputM) {
        const body2 = new URLSearchParams({ news: myInputM[1], submit: 'submit' }).toString();
        playerHtml = await this.requestText(myUrlM[1], {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': form1Action[1],
            'Origin': 'https://aa.3isk.icu',
          },
          body: body2,
        });
      }

      const embedM = playerHtml.match(/<iframe[^>]*src=["'](https:\/\/3iskk\.xyz\/embed\/[^"']+)["']/);
      if (!embedM) {
        const anyIframe = playerHtml.match(/<iframe[^>]*src=["']([^"']+)["']/);
        if (anyIframe) {
          result.embedUrl = anyIframe[1];
          result.success = true;
          result.durationMs = Date.now() - t0;
          this.attachUrls(result, baseUrl);
          this.streamCache.set(targetUrl, { data: result, expiresAt: Date.now() + 1800000 });
          return result;
        }
        throw new Error('Embed player iframe not found');
      }

      const embedHtml = await this.requestText(embedM[1], {
        headers: { Referer: 'https://aa.3isk.icu/' },
      });

      const cdnIframes = embedHtml.match(/<iframe[^>]*src=["']([^"']+)["']/);
      if (!cdnIframes) {
        result.embedUrl = embedM[1];
        result.success = true;
        result.durationMs = Date.now() - t0;
        this.attachUrls(result, baseUrl);
        this.streamCache.set(targetUrl, { data: result, expiresAt: Date.now() + 1800000 });
        return result;
      }

      const cdnUrl = cdnIframes[1];
      result.embedUrl = cdnUrl;

      if (cdnUrl.includes('ukrcdn')) {
        result.cdnType = 'ukrcdn';
        const cdnHtml = await this.requestText(cdnUrl, {
          headers: { Referer: 'https://3iskk.xyz/' },
        });
        const pbM = cdnHtml.match(/fetch\(['"](https:[^"']+playback\?g=[^"']+)['"]/);
        if (pbM) {
          const pbUrl = pbM[1].replace(/\\\//g, '/');
          const pbJsonStr = await this.requestText(pbUrl, {
            headers: {
              Referer: cdnUrl,
              Accept: 'application/json',
            },
          });
          const pbData = JSON.parse(pbJsonStr);
          if (pbData.url) {
            result.hlsUrl = pbData.url;
          }
        }
      } else {
        const cdnHtml = await this.requestText(cdnUrl, {
          headers: { Referer: 'https://3iskk.xyz/' },
        });
        const packedM = cdnHtml.match(/eval\(function\(p,a,c,k,e,d\)\{.*?\}\('(.*?)',(\d+),(\d+),'(.*?)'\.split\('\|'\)/s);
        if (packedM) {
          const unpacked = this.unpackDeanEdwards(packedM[1], parseInt(packedM[2], 10), parseInt(packedM[3], 10), packedM[4]);
          const m3u8M = unpacked.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/);
          if (m3u8M) {
            result.hlsUrl = m3u8M[0];
            result.cdnType = 'packed_hls';
          }
        }
      }

      result.success = true;
      result.durationMs = Date.now() - t0;
      this.attachUrls(result, baseUrl);
      this.streamCache.set(targetUrl, { data: result, expiresAt: Date.now() + 1800000 });
      return result;
    } catch (err: any) {
      result.error = err.message;
      result.durationMs = Date.now() - t0;
      return result;
    }
  }

  private attachUrls(result: ResolvedVodStream, baseUrl: string) {
    if (result.hlsUrl) {
      result.streamProxyUrl = `${baseUrl}/api/app/vod/stream?url=${encodeURIComponent(result.hlsUrl)}`;
    }
    result.playerUrl = `${baseUrl}/api/app/vod/player?url=${encodeURIComponent(result.targetUrl)}`;
  }

  private unpackDeanEdwards(p: string, a: number, c: number, k: string): string {
    try {
      const e = (cVal: number): string =>
        (cVal < a ? '' : e(Math.floor(cVal / a))) +
        (cVal % a > 35 ? String.fromCharCode((cVal % a) + 29) : (cVal % a).toString(36));
      const kList = k.split('|');
      const dMap: { [key: string]: string } = {};
      for (let i = 0; i < c; i++) {
        dMap[e(i)] = kList[i] || e(i);
      }
      return p.replace(/\b\w+\b/g, w => (dMap[w] !== undefined ? dMap[w] : w));
    } catch {
      return '';
    }
  }

  private async requestText(url: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<string> {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const headers = {
      'User-Agent': USER_AGENT,
      ...(options.headers || {}),
    };

    return new Promise((resolve, reject) => {
      const req = client.request(
        url,
        {
          method: options.method || 'GET',
          headers,
          rejectUnauthorized: false,
        },
        res => {
          let data = '';
          res.on('data', chunk => (data += chunk));
          res.on('end', () => resolve(data));
        }
      );

      req.on('error', reject);
      req.setTimeout(12000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }

  public syncCatalogInBackground() {
    const scriptPath = path.resolve(process.cwd(), 'scripts/harvest_3isk_vod.py');
    const child = spawn('python', [scriptPath], {
      detached: true,
      stdio: 'ignore',
      cwd: process.cwd(),
    });
    child.unref();
  }
}

export const vodService = new VodService();
