import { directStreamService } from './direct-stream.service';

export interface GlobalMediaItem {
  id: number;
  tmdb_id: number;
  title: string;
  original_title?: string;
  overview: string;
  thumbnail: string;
  raw_thumbnail: string;
  backdrop: string | null;
  release_date: string;
  type: 'movie' | 'tv';
  rating: number;
  country: string;
  genres: string[];
  episodes_count?: number;
}

export interface GlobalMediaDetail {
  id: number;
  tmdb_id: number;
  title: string;
  original_title?: string;
  overview: string;
  thumbnail: string;
  raw_thumbnail: string;
  backdrop: string | null;
  release_date: string;
  type: 'movie' | 'tv';
  rating: number;
  country: string;
  genres: string[];
  seasons_count: number;
  episodes_count: number;
  seasons: Array<{
    season_number: number;
    name: string;
    episode_count: number;
  }>;
  episodes: Array<{
    id: number;
    episode_number: number;
    season_number: number;
    title: string;
    overview: string;
    thumbnail: string | null;
    stream_url: string;
    subtitles_url: string;
    direct_mp4?: string | null;
  }>;
}

export class GlobalMediaService {
  private static instance: GlobalMediaService;
  private readonly TMDB_KEY = '4e44d9029b1270a757cddc766a1bcb63';
  private readonly TMDB_IMG_BASE = 'https://image.tmdb.org/t/p/w500';
  private readonly TMDB_BACKDROP_BASE = 'https://image.tmdb.org/t/p/original';
  private cache = new Map<string, { data: any; expiresAt: number }>();

  private constructor() {}

  public static getInstance(): GlobalMediaService {
    if (!GlobalMediaService.instance) {
      GlobalMediaService.instance = new GlobalMediaService();
    }
    return GlobalMediaService.instance;
  }

  public async getCatalog(params: {
    page?: number;
    type?: 'all' | 'movie' | 'tv' | 'anime';
    country?: string;
    genre?: string;
    order?: string;
    q?: string;
  }): Promise<{ total: number; page: number; pageSize: number; total_pages: number; items: GlobalMediaItem[] }> {
    const page = params.page || 1;
    const mediaType = params.type || 'all';
    const country = params.country || 'ALL';
    const genre = params.genre || 'ALL';
    const q = (params.q || '').trim();
    const order = params.order || 'popularity.desc';

    const cacheKey = `cat_${page}_${mediaType}_${country}_${genre}_${order}_${q}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    try {
      if (q) {
        // Global Multi Search
        const searchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${this.TMDB_KEY}&language=ar-SA&query=${encodeURIComponent(q)}&page=${page}&include_adult=false`;
        const res = await fetch(searchUrl, { signal: AbortSignal.timeout(6000) });
        const data = await res.json();
        const results = Array.isArray(data.results) ? data.results : [];

        const items: GlobalMediaItem[] = results
          .filter((item: any) => {
            if (item.media_type !== 'movie' && item.media_type !== 'tv') return false;
            // Exclude Turkey (TR) strictly because Turkish is in 3isk
            const origins = item.origin_country || [];
            if (origins.includes('TR')) return false;
            return Boolean(item.poster_path);
          })
          .map((item: any) => this.mapTmdbToItem(item, item.media_type));

        const result = {
          total: data.total_results || items.length,
          page,
          pageSize: 20,
          total_pages: Math.min(data.total_pages || 1, 500),
          items,
        };

        this.cache.set(cacheKey, { data: result, expiresAt: Date.now() + 10 * 60 * 1000 });
        return result;
      }

      // Discover Mode
      const isAnime = mediaType === 'anime';
      const endpoint = mediaType === 'movie' ? 'movie' : 'tv';

      let discoverUrl = `https://api.themoviedb.org/3/discover/${endpoint}?api_key=${this.TMDB_KEY}&language=ar-SA&sort_by=${order}&page=${page}&without_origin_country=TR&include_adult=false`;

      if (isAnime) {
        // Anime is Animation genre (16) from Japan (JP)
        discoverUrl += '&with_genres=16&with_origin_country=JP';
      } else {
        if (country !== 'ALL') {
          discoverUrl += `&with_origin_country=${country}`;
        }
        if (genre !== 'ALL' && /^[0-9]+$/.test(genre)) {
          discoverUrl += `&with_genres=${genre}`;
        }
      }

      // For US TV shows, exclude talk shows & soap operas by default for quality cinema
      if (country === 'US' && endpoint === 'tv' && genre === 'ALL') {
        discoverUrl += '&without_genres=10767,10763';
      }

      const res = await fetch(discoverUrl, { signal: AbortSignal.timeout(6000) });
      const data = await res.json();
      const results = Array.isArray(data.results) ? data.results : [];

      const items: GlobalMediaItem[] = results
        .filter((item: any) => {
          const origins = item.origin_country || [];
          if (origins.includes('TR')) return false;
          return Boolean(item.poster_path);
        })
        .map((item: any) => this.mapTmdbToItem(item, endpoint));

      const result = {
        total: data.total_results || items.length,
        page,
        pageSize: 20,
        total_pages: Math.min(data.total_pages || 1, 500),
        items,
      };

      this.cache.set(cacheKey, { data: result, expiresAt: Date.now() + 15 * 60 * 1000 });
      return result;
    } catch (err: any) {
      console.error('[GlobalMedia] getCatalog error:', err.message);
      return { total: 0, page: 1, pageSize: 20, total_pages: 1, items: [] };
    }
  }

  public async getDetails(
    tmdbId: number | string,
    type: 'movie' | 'tv',
    seasonNumber = 1,
    baseUrl = ''
  ): Promise<GlobalMediaDetail | null> {
    const cacheKey = `det_${tmdbId}_${type}_${seasonNumber}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    try {
      const detailsUrl = `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${this.TMDB_KEY}&language=ar-SA`;
      const res = await fetch(detailsUrl, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return null;
      const data = await res.json();

      const title = data.title || data.name || 'عمل عالمي';
      const originalTitle = data.original_title || data.original_name || '';
      const overview = data.overview || 'مشاهدة وتحميل بجودة عالية مع الترجمة العربية المدمجة على مشغل Aspreen VIP.';
      const thumbnail = data.poster_path ? `${this.TMDB_IMG_BASE}${data.poster_path}` : '';
      const backdrop = data.backdrop_path ? `${this.TMDB_BACKDROP_BASE}${data.backdrop_path}` : null;
      const releaseDate = data.release_date || data.first_air_date || '';
      const rating = Number(data.vote_average?.toFixed(1)) || 0;
      const genres = Array.isArray(data.genres) ? data.genres.map((g: any) => g.name) : [];
      const country = Array.isArray(data.origin_country) && data.origin_country.length > 0 ? data.origin_country[0] : 'Global';

      if (type === 'movie') {
        const episodes = [
          {
            id: 1,
            episode_number: 1,
            season_number: 1,
            title: 'مشاهدة الفيلم كامل (Full Movie)',
            overview: overview,
            thumbnail: backdrop || thumbnail,
            stream_url: `${baseUrl}/api/app/global/stream?tmdbId=${tmdbId}&type=movie`,
            subtitles_url: `${baseUrl}/api/app/global/subtitles?tmdbId=${tmdbId}&type=movie`,
          },
        ];

        const detail: GlobalMediaDetail = {
          id: data.id,
          tmdb_id: data.id,
          title,
          original_title: originalTitle,
          overview,
          thumbnail,
          raw_thumbnail: thumbnail,
          backdrop,
          release_date: releaseDate,
          type: 'movie',
          rating,
          country,
          genres,
          seasons_count: 1,
          episodes_count: 1,
          seasons: [{ season_number: 1, name: 'الفيلم', episode_count: 1 }],
          episodes,
        };

        this.cache.set(cacheKey, { data: detail, expiresAt: Date.now() + 30 * 60 * 1000 });
        return detail;
      }

      // TV Show
      const seasons = Array.isArray(data.seasons)
        ? data.seasons
            .filter((s: any) => s.season_number > 0)
            .map((s: any) => ({
              season_number: s.season_number,
              name: s.name || `الموسم ${s.season_number}`,
              episode_count: s.episode_count || 1,
            }))
        : [{ season_number: 1, name: 'الموسم 1', episode_count: 1 }];

      // Fetch season episodes in Arabic
      const seasonUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}?api_key=${this.TMDB_KEY}&language=ar-SA`;
      const seasonRes = await fetch(seasonUrl, { signal: AbortSignal.timeout(6000) });
      const seasonData = seasonRes.ok ? await seasonRes.json() : {};
      const rawEpisodes = Array.isArray(seasonData.episodes) ? seasonData.episodes : [];

      const episodes = rawEpisodes.map((ep: any) => ({
        id: ep.id || ep.episode_number,
        episode_number: ep.episode_number,
        season_number: seasonNumber,
        title: ep.name && !ep.name.startsWith('Episode') ? ep.name : `الحلقة ${ep.episode_number}`,
        overview: ep.overview || '',
        thumbnail: ep.still_path ? `${this.TMDB_IMG_BASE}${ep.still_path}` : backdrop || thumbnail,
        stream_url: `${baseUrl}/api/app/global/stream?tmdbId=${tmdbId}&type=tv&season=${seasonNumber}&ep=${ep.episode_number}`,
        subtitles_url: `${baseUrl}/api/app/global/subtitles?tmdbId=${tmdbId}&type=tv&season=${seasonNumber}&ep=${ep.episode_number}`,
      }));

      const detail: GlobalMediaDetail = {
        id: data.id,
        tmdb_id: data.id,
        title,
        original_title: originalTitle,
        overview,
        thumbnail,
        raw_thumbnail: thumbnail,
        backdrop,
        release_date: releaseDate,
        type: 'tv',
        rating,
        country,
        genres,
        seasons_count: seasons.length,
        episodes_count: episodes.length,
        seasons,
        episodes,
      };

      this.cache.set(cacheKey, { data: detail, expiresAt: Date.now() + 30 * 60 * 1000 });
      return detail;
    } catch (err: any) {
      console.error('[GlobalMedia] getDetails error:', err.message);
      return null;
    }
  }

  private mapTmdbToItem(item: any, type: 'movie' | 'tv'): GlobalMediaItem {
    const title = item.title || item.name || '';
    const originalTitle = item.original_title || item.original_name || '';
    const thumbnail = item.poster_path ? `${this.TMDB_IMG_BASE}${item.poster_path}` : '';
    const backdrop = item.backdrop_path ? `${this.TMDB_BACKDROP_BASE}${item.backdrop_path}` : null;
    const releaseDate = (item.release_date || item.first_air_date || '').substring(0, 4);
    const rating = Number(item.vote_average?.toFixed(1)) || 0;
    const country = Array.isArray(item.origin_country) && item.origin_country.length > 0 ? item.origin_country[0] : 'US';

    return {
      id: item.id,
      tmdb_id: item.id,
      title,
      original_title: originalTitle,
      overview: item.overview || '',
      thumbnail,
      raw_thumbnail: thumbnail,
      backdrop,
      release_date: releaseDate,
      type,
      rating,
      country,
      genres: [],
    };
  }
}

export const globalMediaService = GlobalMediaService.getInstance();
