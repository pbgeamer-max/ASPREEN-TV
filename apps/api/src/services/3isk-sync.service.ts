import * as fs from 'fs';
import * as path from 'path';

export interface EpisodeItem {
  episodeNumber: number;
  title: string;
  watchUrl: string;
}

export interface SeriesItem {
  id: string;
  title: string;
  type: 'SERIES';
  category: string;
  poster: string;
  seriesUrl: string;
  description: string;
  episodes_count?: number;
  episodes: EpisodeItem[];
}

export interface MovieItem {
  id: string;
  title: string;
  type: 'MOVIE';
  category: string;
  poster: string;
  watchUrl: string;
  description: string;
}

export interface CatalogData {
  series: SeriesItem[];
  movies: MovieItem[];
  updatedAt: string;
}

class ThreeIskSyncService {
  private catalog: CatalogData | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  private isSyncing = false;
  private readonly userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  private getCatalogFilePath(): string {
    const candidates = [
      path.join(process.cwd(), 'data', '3isk_catalog.json'),
      path.join(process.cwd(), '..', '..', 'data', '3isk_catalog.json'),
      path.join(__dirname, '..', '..', 'data', '3isk_catalog.json'),
      '/app/data/3isk_catalog.json',
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }

    return path.join(process.cwd(), 'data', '3isk_catalog.json');
  }

  public getCatalog(): CatalogData {
    if (this.catalog) {
      return this.catalog;
    }

    const filePath = this.getCatalogFilePath();
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        this.catalog = JSON.parse(raw);
        return this.catalog!;
      } catch (err: any) {
        console.error('[3isk Sync] Error reading catalog file:', err.message);
      }
    }

    this.catalog = {
      series: [],
      movies: [],
      updatedAt: new Date().toISOString(),
    };
    return this.catalog;
  }

  private saveCatalog(data: CatalogData) {
    this.catalog = data;
    const filePath = this.getCatalogFilePath();
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`[3isk Sync] Successfully persisted catalog to ${filePath}`);
    } catch (err: any) {
      console.error('[3isk Sync] Failed to write catalog file:', err.message);
    }
  }

  private async fetchHtml(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: {
        'User-Agent': this.userAgent,
        'Referer': 'https://3iskk.xyz/',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
  }

  /**
   * Main sync function: checks latest episodes, series, and movies
   */
  public async syncLatest(): Promise<{ newEpisodes: number; newMovies: number; newSeries: number }> {
    if (this.isSyncing) {
      console.log('[3isk Sync] Sync already in progress, skipping duplicate call.');
      return { newEpisodes: 0, newMovies: 0, newSeries: 0 };
    }

    this.isSyncing = true;
    let newEpisodesCount = 0;
    let newMoviesCount = 0;
    let newSeriesCount = 0;

    try {
      console.log('🔄 [3isk Auto-Sync] Checking 3isk for new movies, series, and episodes...');
      const current = this.getCatalog();
      const seriesList = [...current.series];
      const moviesList = [...current.movies];

      // 1. Sync Latest Movies (w-mvs)
      try {
        const moviesHtml = await this.fetchHtml('https://3iskk.xyz/w-mvs/');
        const movieMatches = [...moviesHtml.matchAll(/<a href="(https:\/\/3iskk\.xyz\/watch\/movies\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];

        for (const m of movieMatches) {
          const url = m[1];
          const inner = m[2];
          const slug = url.split('/').filter(Boolean).pop() || '';
          
          if (!moviesList.some((existing) => existing.id === slug || existing.watchUrl === url)) {
            const titleMatch = inner.match(/<div class="item_title">([^<]+)<\/div>/);
            const imgMatch =
              inner.match(/data-image="([^"]+)"/) ||
              inner.match(/data-src="([^"]+)"/) ||
              inner.match(/src="([^"]+)"/);

            const title = titleMatch ? titleMatch[1].trim() : 'فيلم تركي جديد';
            const rawPoster = imgMatch ? imgMatch[1] : '';
            const poster = rawPoster.includes('dt_poster') ? '' : rawPoster;

            const newMovie: MovieItem = {
              id: slug,
              title,
              type: 'MOVIE',
              category: title.includes('مدبلج') ? 'أفلام مدبلجة' : 'أفلام مترجمة',
              poster,
              watchUrl: url,
              description: `مشاهدة وتحميل ${title} بجودة عالية فور صدوره على قصة عشق.`,
            };

            moviesList.unshift(newMovie);
            newMoviesCount++;
            console.log(`  ➕ [3isk Sync] فيلم جديد مضاف: ${title}`);
          }
        }
      } catch (err: any) {
        console.warn('[3isk Sync] Error syncing movies:', err.message);
      }

      // 2. Sync Latest Episodes (w-hlqat)
      try {
        const epHtml = await this.fetchHtml('https://3iskk.xyz/w-hlqat/');
        const epMatches = [...epHtml.matchAll(/<a href="(https:\/\/3iskk\.xyz\/watch\/episodes\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];

        for (const m of epMatches) {
          const epUrl = m[1];
          const inner = m[2];
          const titleMatch = inner.match(/<div class="item_title">([^<]+)<\/div>/);
          const rawTitle = titleMatch ? titleMatch[1].trim() : '';

          const epNumMatch =
            inner.match(/<div class="item_episode">([^<]+)<\/div>/) ||
            rawTitle.match(/الحلقة\s*(\d+)/i) ||
            epUrl.match(/episode-(\d+)/i);

          const epNum = epNumMatch ? parseInt(epNumMatch[1], 10) : 1;

          // Extract series base title (e.g. "مسلسل اصطدام مدبلج" from "مسلسل اصطدام مدبلج الحلقة 51")
          const cleanSeriesTitle = rawTitle.replace(/الحلقة\s*\d+/i, '').trim();

          // Find if we have this series in our catalog
          let targetSeries = seriesList.find((s) => {
            if (s.title === cleanSeriesTitle) return true;
            if (cleanSeriesTitle && s.title.includes(cleanSeriesTitle)) return true;
            const sSlug = s.seriesUrl.split('/').filter(Boolean).pop() || '';
            return sSlug && epUrl.includes(sSlug.replace(/-season-\d+/, ''));
          });

          if (targetSeries) {
            // Check if episode already exists
            if (!targetSeries.episodes.some((e) => e.watchUrl === epUrl || e.episodeNumber === epNum)) {
              targetSeries.episodes.push({
                episodeNumber: epNum,
                title: `الحلقة ${epNum}`,
                watchUrl: epUrl,
              });
              targetSeries.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
              targetSeries.episodes_count = targetSeries.episodes.length;
              newEpisodesCount++;
              console.log(`  ➕ [3isk Sync] حلقة جديدة مضافة: ${targetSeries.title} - الحلقة ${epNum}`);
            }
          }
        }
      } catch (err: any) {
        console.warn('[3isk Sync] Error syncing episodes:', err.message);
      }

      // 3. Sync Latest Series (w-srs)
      try {
        const seriesHtml = await this.fetchHtml('https://3iskk.xyz/w-srs/');
        const seriesMatches = [...seriesHtml.matchAll(/<a href="(https:\/\/3iskk\.xyz\/watch\/(?:tvshows|series)\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];

        for (const m of seriesMatches) {
          const url = m[1];
          const inner = m[2];
          const slug = url.split('/').filter(Boolean).pop() || '';

          if (!seriesList.some((s) => s.id === slug || s.seriesUrl === url)) {
            const titleMatch = inner.match(/<div class="item_title">([^<]+)<\/div>/);
            const imgMatch =
              inner.match(/data-image="([^"]+)"/) ||
              inner.match(/data-src="([^"]+)"/) ||
              inner.match(/src="([^"]+)"/);

            const title = titleMatch ? titleMatch[1].trim() : 'مسلسل تركي جديد';
            const rawPoster = imgMatch ? imgMatch[1] : '';
            const poster = rawPoster.includes('dt_poster') ? '' : rawPoster;

            // Fetch series page to get real episodes
            let episodes: EpisodeItem[] = [];
            let description = `مسلسل ${title} - أحدث الحلقات على قصة عشق.`;

            try {
              const sHtml = await this.fetchHtml(url);
              const descMatch = sHtml.match(/<div class="description"[^>]*>([\s\S]*?)<\/div>/i) || sHtml.match(/<meta name="description" content="([^"]+)"/i);
              if (descMatch) {
                description = descMatch[1].replace(/<[^>]+>/g, '').trim();
              }

              const epLinks = [...sHtml.matchAll(/<a[^>]*href=['"](https:\/\/3iskk\.xyz\/watch\/episodes\/[^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi)];
              for (const ep of epLinks) {
                const epUrl = ep[1];
                const epInner = ep[2].replace(/<[^>]+>/g, '').trim();
                const epNumMatch = epUrl.match(/episode-(\d+)/i) || epInner.match(/(\d+)/);
                const epNum = epNumMatch ? parseInt(epNumMatch[1], 10) : (episodes.length + 1);
                episodes.push({
                  episodeNumber: epNum,
                  title: `الحلقة ${epNum}`,
                  watchUrl: epUrl,
                });
              }
              episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
            } catch {}

            const newSeriesItem: SeriesItem = {
              id: slug,
              title,
              type: 'SERIES',
              category: title.includes('مدبلج') ? 'مسلسلات مدبلجة' : 'مسلسلات مترجمة',
              poster,
              seriesUrl: url,
              description,
              episodes_count: episodes.length,
              episodes,
            };

            seriesList.unshift(newSeriesItem);
            newSeriesCount++;
            console.log(`  ➕ [3isk Sync] مسلسل جديد مضاف: ${title} (${episodes.length} حلقة)`);
          }
        }
      } catch (err: any) {
        console.warn('[3isk Sync] Error syncing series:', err.message);
      }

      // If changes occurred, save to disk and update catalog
      if (newEpisodesCount > 0 || newMoviesCount > 0 || newSeriesCount > 0) {
        const updatedData: CatalogData = {
          series: seriesList,
          movies: moviesList,
          updatedAt: new Date().toISOString(),
        };
        this.saveCatalog(updatedData);
        console.log(
          `✨ [3isk Auto-Sync] اكتمل التحديث بنجاح: تم إضافة (${newEpisodesCount} حلقة جديدة، ${newMoviesCount} فيلم، ${newSeriesCount} مسلسل).`
        );
      } else {
        console.log('[3isk Auto-Sync] الكتالوج محدث بالكامل (لا توجد أعمال جديدة حالياً).');
      }
    } catch (err: any) {
      console.error('[3isk Auto-Sync] Sync failed with error:', err.message);
    } finally {
      this.isSyncing = false;
    }

    return {
      newEpisodes: newEpisodesCount,
      newMovies: newMoviesCount,
      newSeries: newSeriesCount,
    };
  }

  /**
   * Starts the 24/7 background sync cron (every 15 minutes)
   */
  public startCron(intervalMs = 15 * 60 * 1000) {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }

    // Run initial sync 5 seconds after boot
    setTimeout(() => {
      this.syncLatest().catch(() => {});
    }, 5000);

    // Schedule recurring sync
    this.syncTimer = setInterval(() => {
      this.syncLatest().catch(() => {});
    }, intervalMs);

    console.log(`[3isk Service] Auto-sync daemon scheduled to run every ${intervalMs / 60000} minutes.`);
  }

  public stopCron() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }
}

export const threeIskSyncService = new ThreeIskSyncService();
