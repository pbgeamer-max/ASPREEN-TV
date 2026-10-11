import https from 'https';
import http from 'http';
import { vodRepository, Movie, Series, Episode } from '../repositories/vod.repository';

export interface FiveTvSyncReport {
  moviesAdded: number;
  seriesAdded: number;
  episodesAdded: number;
  totalMovies: number;
  totalSeries: number;
  newEpisodes: number;
  durationMs: number;
}

export class FiveTvService {
  private readonly BASE_URL = 'https://new61.5tv.lol';
  private readonly USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  private autoUpdateInterval: NodeJS.Timeout | null = null;
  private isSyncing = false;

  /**
   * Resilient HTTP GET request with redirect following
   */
  private fetchHtml(url: string, retries = 2): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const client = isHttps ? https : http;

      const req = client.get({
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        headers: {
          'User-Agent': this.USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ar,en-US;q=0.8,en;q=0.7',
          'Referer': this.BASE_URL + '/',
          'Cookie': 'ftv_vip_checked=1',
        },
      }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let loc = res.headers.location;
          if (!loc.startsWith('http')) {
            loc = new URL(loc, url).toString();
          }
          return this.fetchHtml(loc, retries - 1).then(resolve).catch(reject);
        }

        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`HTTP error ${res.statusCode} for ${url}`));
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });

      req.on('error', (err) => {
        if (retries > 0) {
          setTimeout(() => {
            this.fetchHtml(url, retries - 1).then(resolve).catch(reject);
          }, 1000);
        } else {
          reject(err);
        }
      });

      req.setTimeout(12000, () => {
        req.destroy();
        if (retries > 0) {
          this.fetchHtml(url, retries - 1).then(resolve).catch(reject);
        } else {
          reject(new Error(`Timeout fetching ${url}`));
        }
      });
    });
  }

  /**
   * Title normalization for zero duplicates across all providers
   */
  public normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/^(فيلم|مسلسل|انمي)\s+/i, '')
      .replace(/(مترجم|مدبلج|كامل|اون لاين|اونلاين|بجودة|hd|web-dl|bluray)/gi, '')
      .replace(/[^\w\u0600-\u06FF]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .trim();
  }

  /**
   * Extract working stream and metadata from a 5tv page
   */
  private async extractWatchDetails(pageUrl: string): Promise<{
    title: string | null;
    streamUrl: string | null;
    posterUrl: string | null;
    description: string | null;
    rating: number | null;
  }> {
    try {
      const html = await this.fetchHtml(pageUrl);
      const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      const iframeMatch = html.match(/<iframe[^>]+src="([^"]+)"/i);
      const posterMatch = html.match(/<meta property="og:image" content="([^"]+)"/i);
      const descMatch = html.match(/<meta property="og:description" content="([^"]+)"/i)
        || html.match(/<div class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      const ratingMatch = html.match(/class="[^"]*rating[^"]*"[^>]*>([\d.]+)/i);

      let cleanDesc: string | null = null;
      if (descMatch) {
        cleanDesc = descMatch[1].replace(/<[^>]+>/g, '').trim();
      }

      return {
        title: titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : null,
        streamUrl: iframeMatch ? iframeMatch[1] : null,
        posterUrl: posterMatch ? posterMatch[1] : null,
        description: cleanDesc,
        rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
      };
    } catch {
      return { title: null, streamUrl: null, posterUrl: null, description: null, rating: null };
    }
  }

  /**
   * Crawl movies from FiveTV catalog
   */
  async scrapeMovies(maxPages = 6): Promise<number> {
    let totalAdded = 0;

    for (let page = 1; page <= maxPages; page++) {
      const pageUrl = page === 1 ? `${this.BASE_URL}/latest-movies/` : `${this.BASE_URL}/latest-movies/page/${page}/`;
      try {
        const html = await this.fetchHtml(pageUrl);
        // Find movie cards
        const movieLinks = [...new Set([...html.matchAll(/href="([^"]*\/movie\/[^"]*)"/gi)].map(m => m[1]))];

        if (movieLinks.length === 0) break;

        // Process in chunks of 5
        const chunkSize = 5;
        for (let i = 0; i < movieLinks.length; i += chunkSize) {
          const chunk = movieLinks.slice(i, i + chunkSize);
          await Promise.all(chunk.map(async (mUrl) => {
            try {
              const details = await this.extractWatchDetails(mUrl);
              const rawTitle = details.title || '';
              if (!rawTitle) return;

              const yearMatch = rawTitle.match(/\b(19\d{2}|20\d{2})\b/);
              const releaseYear = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();

              const streamUrl = details.streamUrl || mUrl;

              await vodRepository.upsertMovie({
                title: rawTitle,
                normalizedTitle: this.normalizeTitle(rawTitle),
                category: 'أفلام فايف تي في FiveTV',
                posterUrl: details.posterUrl || undefined,
                description: details.description || `مشاهدة وتحميل ${rawTitle} أون لاين على أسبيرين TV.`,
                releaseYear,
                rating: details.rating || 8.0,
                streamUrl,
                containerExtension: 'html',
              });

              totalAdded++;
            } catch (err: any) {
              console.error(`Error processing 5tv movie ${mUrl}:`, err.message);
            }
          }));
        }
      } catch (err: any) {
        console.error(`Error scraping 5tv movies page ${page}:`, err.message);
      }
    }

    return totalAdded;
  }

  /**
   * Crawl TV Series and all their ordered seasons & episodes from FiveTV
   */
  async scrapeSeries(maxPages = 4, maxSeries = 30): Promise<{ seriesAdded: number; episodesAdded: number }> {
    let seriesAdded = 0;
    let episodesAdded = 0;

    for (let page = 1; page <= maxPages; page++) {
      if (seriesAdded >= maxSeries) break;
      const pageUrl = page === 1 ? `${this.BASE_URL}/latest-series/` : `${this.BASE_URL}/latest-series/page/${page}/`;
      try {
        const html = await this.fetchHtml(pageUrl);
        const seriesLinks = [...new Set([...html.matchAll(/href="([^"]*\/series\/[^"]*)"/gi)].map(m => m[1]))];

        if (seriesLinks.length === 0) break;

        for (const sUrl of seriesLinks) {
          if (seriesAdded >= maxSeries) break;
          try {
            const sHtml = await this.fetchHtml(sUrl);
            const titleMatch = sHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
            const rawTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
            if (!rawTitle) continue;

            const posterMatch = sHtml.match(/<meta property="og:image" content="([^"]+)"/i);
            const descMatch = sHtml.match(/<meta property="og:description" content="([^"]+)"/i);
            const yearMatch = rawTitle.match(/\b(19\d{2}|20\d{2})\b/);
            const releaseYear = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();

            // Extract episodes from series page
            const epMatches = [...sHtml.matchAll(/<a[^>]*href="([^"]*\/episode\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)];
            const seenEpUrls = new Set<string>();
            const epList: Array<{ epUrl: string; seasonNum: number; episodeNum: number; epTitle: string }> = [];

            for (const epM of epMatches) {
              const epUrl = epM[1];
              if (seenEpUrls.has(epUrl)) continue;
              seenEpUrls.add(epUrl);

              const text = epM[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

              let seasonNum = 1;
              let episodeNum = 1;

              // Check for Season x Episode patterns e.g. 2x1, S02E01
              const sxMatch = epUrl.match(/(\d+)x(\d+)/i) || text.match(/(\d+)x(\d+)/i);
              const seMatch = epUrl.match(/s(\d+)e(\d+)/i) || text.match(/s(\d+)e(\d+)/i);

              if (sxMatch) {
                seasonNum = parseInt(sxMatch[1], 10);
                episodeNum = parseInt(sxMatch[2], 10);
              } else if (seMatch) {
                seasonNum = parseInt(seMatch[1], 10);
                episodeNum = parseInt(seMatch[2], 10);
              } else {
                const seasonTextMatch = text.match(/الموسم\s*(\d+)/i) || epUrl.match(/season-(\d+)/i);
                if (seasonTextMatch) seasonNum = parseInt(seasonTextMatch[1], 10);

                const epTextMatch = text.match(/الحلقة\s*(\d+)/i) || epUrl.match(/episode-(\d+)/i) || epUrl.match(/-(\d+)\/?$/);
                if (epTextMatch) episodeNum = parseInt(epTextMatch[1], 10);
              }

              epList.push({
                epUrl,
                seasonNum,
                episodeNum,
                epTitle: `الموسم ${seasonNum} - الحلقة ${episodeNum}`,
              });
            }

            const maxSeason = epList.reduce((max, ep) => Math.max(max, ep.seasonNum), 1);

            // Upsert series
            const series = await vodRepository.upsertSeries({
              title: rawTitle,
              normalizedTitle: this.normalizeTitle(rawTitle),
              category: 'مسلسلات فايف تي في FiveTV',
              posterUrl: posterMatch ? posterMatch[1] : undefined,
              description: descMatch ? descMatch[1] : `مسلسل ${rawTitle} كامل المواسم والحلقات على أسبيرين TV.`,
              releaseYear,
              rating: 8.5,
              totalSeasons: maxSeason,
            });

            seriesAdded++;

            // High-throughput episode ingestion: all episodes are immediately registered with their embed watch URL
            for (const ep of epList) {
              await vodRepository.upsertEpisode({
                seriesId: series.id,
                seasonNum: ep.seasonNum,
                episodeNum: ep.episodeNum,
                title: ep.epTitle,
                posterUrl: posterMatch ? posterMatch[1] : series.posterUrl,
                description: `${rawTitle} - ${ep.epTitle}`,
                streamUrl: ep.epUrl,
                containerExtension: 'html',
              });
              episodesAdded++;
            }
          } catch (err: any) {
            console.error(`Error processing 5tv series ${sUrl}:`, err.message);
          }
        }
      } catch (err: any) {
        console.error(`Error scraping 5tv series page ${page}:`, err.message);
      }
    }

    return { seriesAdded, episodesAdded };
  }

  /**
   * Crawl latest additions for immediate updates
   */
  async scrapeRecent(limit = 40): Promise<{ newEpisodes: number; newMovies: number }> {
    let newEpisodes = 0;
    let newMovies = 0;

    try {
      const epHtml = await this.fetchHtml(`${this.BASE_URL}/latest-episodes/`);
      const epLinks = [...new Set([...epHtml.matchAll(/href="([^"]*\/episode\/[^"]*)"/gi)].map(m => m[1]))].slice(0, limit);

      const chunkSize = 4;
      for (let i = 0; i < epLinks.length; i += chunkSize) {
        const chunk = epLinks.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async (epUrl) => {
          try {
            const epDetails = await this.extractWatchDetails(epUrl);
            const rawTitle = epDetails.title || '';
            if (!rawTitle) return;

            // Extract series title and episode info
            let seriesTitle = rawTitle.replace(/—\s*الحلقة.*$/i, '').replace(/الموسم.*$/i, '').trim();
            if (!seriesTitle) seriesTitle = rawTitle;

            let seasonNum = 1;
            let episodeNum = 1;

            const sxMatch = epUrl.match(/(\d+)x(\d+)/i) || rawTitle.match(/(\d+)x(\d+)/i);
            if (sxMatch) {
              seasonNum = parseInt(sxMatch[1], 10);
              episodeNum = parseInt(sxMatch[2], 10);
            } else {
              const sMatch = rawTitle.match(/الموسم\s*(\d+)/i);
              if (sMatch) seasonNum = parseInt(sMatch[1], 10);
              const eMatch = rawTitle.match(/الحلقة\s*(\d+)/i) || epUrl.match(/-(\d+)\/?$/);
              if (eMatch) episodeNum = parseInt(eMatch[1], 10);
            }

            const series = await vodRepository.upsertSeries({
              title: seriesTitle,
              normalizedTitle: this.normalizeTitle(seriesTitle),
              category: 'أحدث حلقات فايف تي في FiveTV',
              posterUrl: epDetails.posterUrl || undefined,
              description: `مسلسل ${seriesTitle} متجدد على أسبيرين TV.`,
              totalSeasons: seasonNum,
            });

            const streamUrl = epDetails.streamUrl || epUrl;

            await vodRepository.upsertEpisode({
              seriesId: series.id,
              seasonNum,
              episodeNum,
              title: `الموسم ${seasonNum} - الحلقة ${episodeNum}`,
              posterUrl: epDetails.posterUrl || series.posterUrl,
              description: epDetails.description || `${seriesTitle} - الحلقة ${episodeNum}`,
              streamUrl,
              containerExtension: 'html',
            });

            newEpisodes++;
          } catch (err: any) {
            console.error(`Error scraping recent 5tv episode ${epUrl}:`, err.message);
          }
        }));
      }
    } catch (err: any) {
      console.error('Error in 5tv scrapeRecent:', err.message);
    }

    return { newEpisodes, newMovies };
  }

  /**
   * Complete FiveTV synchronization
   */
  async syncFiveTv(options: { deep?: boolean; maxMoviePages?: number; maxSeriesPages?: number; recentLimit?: number } = {}): Promise<FiveTvSyncReport> {
    if (this.isSyncing) {
      const stats = await vodRepository.getStats();
      return {
        moviesAdded: 0,
        seriesAdded: 0,
        episodesAdded: 0,
        totalMovies: stats.totalMovies,
        totalSeries: stats.totalSeries,
        newEpisodes: stats.totalEpisodes,
        durationMs: 0,
      };
    }

    this.isSyncing = true;
    const startTime = Date.now();

    const maxMoviePages = options.maxMoviePages || (options.deep ? 15 : 6);
    const maxSeriesPages = options.maxSeriesPages || (options.deep ? 10 : 4);
    const recentLimit = options.recentLimit || (options.deep ? 60 : 30);

    try {
      console.log(`--- Starting FiveTV VOD Sync (deep: ${!!options.deep}, moviePages: ${maxMoviePages}, seriesPages: ${maxSeriesPages}) ---`);

      // 1. Scrape latest episode updates
      const recentStats = await this.scrapeRecent(recentLimit);
      console.log(`[FiveTV] Recent ingested: ${recentStats.newEpisodes} episodes`);

      // 2. Scrape movie catalog
      const moviesAdded = await this.scrapeMovies(maxMoviePages);
      console.log(`[FiveTV] Movie catalog ingested: ${moviesAdded} movies`);

      // 3. Scrape series catalog
      const seriesStats = await this.scrapeSeries(maxSeriesPages, options.deep ? 50 : 25);
      console.log(`[FiveTV] Series catalog ingested: ${seriesStats.seriesAdded} series, ${seriesStats.episodesAdded} episodes`);

      const totalStats = await vodRepository.getStats();
      const durationMs = Date.now() - startTime;

      return {
        moviesAdded,
        seriesAdded: seriesStats.seriesAdded,
        episodesAdded: seriesStats.episodesAdded + recentStats.newEpisodes,
        totalMovies: totalStats.totalMovies,
        totalSeries: totalStats.totalSeries,
        newEpisodes: totalStats.totalEpisodes,
        durationMs,
      };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Start background auto-updater: runs every intervalMinutes
   */
  startAutoUpdater(intervalMinutes = 30): void {
    if (this.autoUpdateInterval) return;

    console.log(`[FiveTV] Auto-updater scheduled every ${intervalMinutes} minutes.`);
    this.autoUpdateInterval = setInterval(async () => {
      try {
        console.log('[FiveTV] Running scheduled background update for newest content...');
        const result = await this.scrapeRecent(25);
        console.log(`[FiveTV] Background update finished: +${result.newEpisodes} episodes`);
      } catch (err: any) {
        console.error('[FiveTV] Background update error:', err.message);
      }
    }, intervalMinutes * 60 * 1000);
  }

  stopAutoUpdater(): void {
    if (this.autoUpdateInterval) {
      clearInterval(this.autoUpdateInterval);
      this.autoUpdateInterval = null;
    }
  }
}

export const fiveTvService = new FiveTvService();
