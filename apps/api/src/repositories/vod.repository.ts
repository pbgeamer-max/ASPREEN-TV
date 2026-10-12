import * as crypto from 'crypto';
import { getPool } from '../db';

export interface MovieServer {
  name: string;
  url: string;
}

export interface Movie {
  id: string;
  title: string;
  normalizedTitle: string;
  category: string;
  posterUrl?: string;
  backdropUrl?: string;
  description?: string;
  releaseYear?: number;
  rating?: number;
  streamUrl: string;
  servers?: MovieServer[];
  containerExtension?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Series {
  id: string;
  title: string;
  normalizedTitle: string;
  category: string;
  posterUrl?: string;
  backdropUrl?: string;
  description?: string;
  releaseYear?: number;
  rating?: number;
  totalSeasons: number;
  createdAt: string;
  updatedAt: string;
  episodes?: Episode[];
}

export interface Episode {
  id: string;
  seriesId: string;
  seasonNum: number;
  episodeNum: number;
  title: string;
  posterUrl?: string;
  description?: string;
  streamUrl: string;
  servers?: MovieServer[];
  containerExtension?: string;
  createdAt: string;
}

// In-memory fallbacks when Postgres is not available
const inMemoryMovies = new Map<string, Movie>();
const inMemorySeries = new Map<string, Series>();
const inMemoryEpisodes = new Map<string, Episode>();

export class VodRepository {
  /**
   * Upsert a movie with strict deduplication by normalized_title
   */
  async upsertMovie(data: Omit<Movie, 'id' | 'createdAt' | 'updatedAt'>): Promise<Movie> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const movie: Movie = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
    };

    if (pool) {
      const res = await pool.query(
        `INSERT INTO movies (
          id, title, normalized_title, category, poster_url, backdrop_url,
          description, release_year, rating, stream_url, container_extension, servers, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (normalized_title) DO UPDATE SET
          category = EXCLUDED.category,
          poster_url = COALESCE(EXCLUDED.poster_url, movies.poster_url),
          backdrop_url = COALESCE(EXCLUDED.backdrop_url, movies.backdrop_url),
          description = COALESCE(EXCLUDED.description, movies.description),
          release_year = COALESCE(EXCLUDED.release_year, movies.release_year),
          rating = COALESCE(EXCLUDED.rating, movies.rating),
          stream_url = EXCLUDED.stream_url,
          container_extension = EXCLUDED.container_extension,
          servers = COALESCE(EXCLUDED.servers, movies.servers),
          updated_at = NOW()
        RETURNING *`,
        [
          movie.id,
          movie.title,
          movie.normalizedTitle,
          movie.category,
          movie.posterUrl || null,
          movie.backdropUrl || null,
          movie.description || null,
          movie.releaseYear || null,
          movie.rating || null,
          movie.streamUrl,
          movie.containerExtension || 'mp4',
          JSON.stringify(movie.servers || []),
          movie.createdAt,
          movie.updatedAt,
        ]
      );
      return this.mapMovieRow(res.rows[0]);
    }

    inMemoryMovies.set(movie.normalizedTitle, movie);
    return movie;
  }

  async listMovies(category?: string, query?: string, limit = 50, offset = 0): Promise<{ items: Movie[]; total: number }> {
    const pool = getPool();
    if (pool) {
      const conditions: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (category && category !== 'all') {
        conditions.push(`category = $${idx++}`);
        values.push(category);
      }
      if (query) {
        conditions.push(`(title ILIKE $${idx} OR description ILIKE $${idx})`);
        values.push(`%${query}%`);
        idx++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const countRes = await pool.query(`SELECT COUNT(*)::int as count FROM movies ${whereClause}`, values);
      const total = countRes.rows[0]?.count || 0;

      values.push(limit, offset);
      const rowsRes = await pool.query(
        `SELECT * FROM movies ${whereClause} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
        values
      );

      return {
        items: rowsRes.rows.map((r) => this.mapMovieRow(r)),
        total,
      };
    }

    let items = Array.from(inMemoryMovies.values());
    if (category && category !== 'all') items = items.filter((m) => m.category === category);
    if (query) items = items.filter((m) => m.title.toLowerCase().includes(query.toLowerCase()));
    const total = items.length;
    return { items: items.slice(offset, offset + limit), total };
  }

  /**
   * Upsert a series with strict deduplication by normalized_title
   */
  async upsertSeries(data: Omit<Series, 'id' | 'createdAt' | 'updatedAt' | 'episodes'>): Promise<Series> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const series: Series = {
      ...data,
      id,
      totalSeasons: data.totalSeasons || 1,
      createdAt: now,
      updatedAt: now,
    };

    if (pool) {
      const res = await pool.query(
        `INSERT INTO series (
          id, title, normalized_title, category, poster_url, backdrop_url,
          description, release_year, rating, total_seasons, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (normalized_title) DO UPDATE SET
          category = EXCLUDED.category,
          poster_url = COALESCE(EXCLUDED.poster_url, series.poster_url),
          backdrop_url = COALESCE(EXCLUDED.backdrop_url, series.backdrop_url),
          description = COALESCE(EXCLUDED.description, series.description),
          release_year = COALESCE(EXCLUDED.release_year, series.release_year),
          rating = COALESCE(EXCLUDED.rating, series.rating),
          total_seasons = GREATEST(series.total_seasons, EXCLUDED.total_seasons),
          updated_at = NOW()
        RETURNING *`,
        [
          series.id,
          series.title,
          series.normalizedTitle,
          series.category,
          series.posterUrl || null,
          series.backdropUrl || null,
          series.description || null,
          series.releaseYear || null,
          series.rating || null,
          series.totalSeasons,
          series.createdAt,
          series.updatedAt,
        ]
      );
      return this.mapSeriesRow(res.rows[0]);
    }

    inMemorySeries.set(series.normalizedTitle, series);
    return series;
  }

  /**
   * Upsert an episode with strict deduplication by (series_id, season_num, episode_num)
   */
  async upsertEpisode(data: Omit<Episode, 'id' | 'createdAt'>): Promise<Episode> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const episode: Episode = {
      ...data,
      id,
      createdAt: now,
    };

    if (pool) {
      const res = await pool.query(
        `INSERT INTO episodes (
          id, series_id, season_num, episode_num, title,
          poster_url, description, stream_url, container_extension, servers, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (series_id, season_num, episode_num) DO UPDATE SET
          title = EXCLUDED.title,
          poster_url = COALESCE(EXCLUDED.poster_url, episodes.poster_url),
          description = COALESCE(EXCLUDED.description, episodes.description),
          stream_url = EXCLUDED.stream_url,
          container_extension = EXCLUDED.container_extension,
          servers = COALESCE(EXCLUDED.servers, episodes.servers)
        RETURNING *`,
        [
          episode.id,
          episode.seriesId,
          episode.seasonNum,
          episode.episodeNum,
          episode.title,
          episode.posterUrl || null,
          episode.description || null,
          episode.streamUrl,
          episode.containerExtension || 'mp4',
          JSON.stringify(episode.servers || []),
          episode.createdAt,
        ]
      );
      return this.mapEpisodeRow(res.rows[0]);
    }

    const key = `${episode.seriesId}_S${episode.seasonNum}_E${episode.episodeNum}`;
    inMemoryEpisodes.set(key, episode);
    return episode;
  }

  async listSeries(category?: string, query?: string, limit = 50, offset = 0): Promise<{ items: Series[]; total: number }> {
    const pool = getPool();
    if (pool) {
      try {
        const conditions: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (category && category !== 'all') {
          conditions.push(`category = $${idx++}`);
          values.push(category);
        }
        if (query) {
          conditions.push(`(title ILIKE $${idx} OR description ILIKE $${idx})`);
          values.push(`%${query}%`);
          idx++;
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const countRes = await pool.query(`SELECT COUNT(*)::int as count FROM series ${whereClause}`, values);
        const total = countRes.rows[0]?.count || 0;

        values.push(limit, offset);
        const rowsRes = await pool.query(
          `SELECT * FROM series ${whereClause} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
          values
        );

        return {
          items: rowsRes.rows.map((r) => this.mapSeriesRow(r)),
          total,
        };
      } catch (err: any) {
        console.error('[VodRepository] Error in listSeries:', err.message);
      }
    }

    let items = Array.from(inMemorySeries.values());
    if (category && category !== 'all') items = items.filter((s) => s.category === category);
    if (query) items = items.filter((s) => s.title.toLowerCase().includes(query.toLowerCase()));
    const total = items.length;
    return { items: items.slice(offset, offset + limit), total };
  }

  async getSeriesWithEpisodes(seriesId: string): Promise<Series | null> {
    const pool = getPool();
    if (pool) {
      try {
        const seriesRes = await pool.query('SELECT * FROM series WHERE id = $1', [seriesId]);
        if (seriesRes.rows.length === 0) return null;

        const series = this.mapSeriesRow(seriesRes.rows[0]);
        const episodesRes = await pool.query(
          'SELECT * FROM episodes WHERE series_id = $1 ORDER BY season_num ASC, episode_num ASC',
          [seriesId]
        );
        series.episodes = episodesRes.rows.map((r) => this.mapEpisodeRow(r));
        return series;
      } catch (err: any) {
        console.error('[VodRepository] Error in getSeriesWithEpisodes:', err.message);
      }
    }

    const series = Array.from(inMemorySeries.values()).find((s) => s.id === seriesId);
    if (!series) return null;
    series.episodes = Array.from(inMemoryEpisodes.values())
      .filter((e) => e.seriesId === seriesId)
      .sort((a, b) => a.seasonNum - b.seasonNum || a.episodeNum - b.episodeNum);
    return series;
  }

  async getDistinctMovieCategories(): Promise<string[]> {
    const pool = getPool();
    if (pool) {
      try {
        const res = await pool.query('SELECT DISTINCT category FROM movies ORDER BY category ASC');
        return res.rows.map((r) => r.category).filter(Boolean);
      } catch (err: any) {
        console.error('[VodRepository] Error in getDistinctMovieCategories:', err.message);
      }
    }
    return Array.from(new Set(Array.from(inMemoryMovies.values()).map((m) => m.category)));
  }

  async getDistinctSeriesCategories(): Promise<string[]> {
    const pool = getPool();
    if (pool) {
      try {
        const res = await pool.query('SELECT DISTINCT category FROM series ORDER BY category ASC');
        return res.rows.map((r) => r.category).filter(Boolean);
      } catch (err: any) {
        console.error('[VodRepository] Error in getDistinctSeriesCategories:', err.message);
      }
    }
    return Array.from(new Set(Array.from(inMemorySeries.values()).map((s) => s.category)));
  }

  async getMovieById(id: string): Promise<Movie | null> {
    const pool = getPool();
    if (pool) {
      try {
        const res = await pool.query('SELECT * FROM movies WHERE id = $1', [id]);
        if (res.rows.length === 0) return null;
        return this.mapMovieRow(res.rows[0]);
      } catch (err: any) {
        console.error('[VodRepository] Error in getMovieById:', err.message);
      }
    }
    return Array.from(inMemoryMovies.values()).find((m) => m.id === id) || null;
  }

  async getEpisodeById(id: string): Promise<Episode | null> {
    const pool = getPool();
    if (pool) {
      try {
        const res = await pool.query('SELECT * FROM episodes WHERE id = $1', [id]);
        if (res.rows.length === 0) return null;
        return this.mapEpisodeRow(res.rows[0]);
      } catch (err: any) {
        console.error('[VodRepository] Error in getEpisodeById:', err.message);
      }
    }
    return Array.from(inMemoryEpisodes.values()).find((e) => e.id === id) || null;
  }

  private mapMovieRow(r: any): Movie {
    let servers: MovieServer[] = [];
    if (Array.isArray(r.servers)) {
      servers = r.servers;
    } else if (typeof r.servers === 'string') {
      try { servers = JSON.parse(r.servers); } catch {}
    }

    return {
      id: r.id,
      title: r.title,
      normalizedTitle: r.normalized_title,
      category: r.category,
      posterUrl: r.poster_url || undefined,
      backdropUrl: r.backdrop_url || undefined,
      description: r.description || undefined,
      releaseYear: r.release_year ? Number(r.release_year) : undefined,
      rating: r.rating ? Number(r.rating) : undefined,
      streamUrl: r.stream_url,
      servers,
      containerExtension: r.container_extension || 'mp4',
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
    };
  }

  private mapSeriesRow(r: any): Series {
    return {
      id: r.id,
      title: r.title,
      normalizedTitle: r.normalized_title,
      category: r.category,
      posterUrl: r.poster_url || undefined,
      backdropUrl: r.backdrop_url || undefined,
      description: r.description || undefined,
      releaseYear: r.release_year ? Number(r.release_year) : undefined,
      rating: r.rating ? Number(r.rating) : undefined,
      totalSeasons: r.total_seasons ? Number(r.total_seasons) : 1,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
    };
  }

  private mapEpisodeRow(r: any): Episode {
    let servers: MovieServer[] = [];
    if (Array.isArray(r.servers)) {
      servers = r.servers;
    } else if (typeof r.servers === 'string') {
      try { servers = JSON.parse(r.servers); } catch {}
    }

    return {
      id: r.id,
      seriesId: r.series_id,
      seasonNum: Number(r.season_num || 1),
      episodeNum: Number(r.episode_num || 1),
      title: r.title,
      posterUrl: r.poster_url || undefined,
      description: r.description || undefined,
      streamUrl: r.stream_url,
      servers,
      containerExtension: r.container_extension || 'mp4',
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    };
  }

  async getStats(): Promise<{ totalMovies: number; totalSeries: number; totalEpisodes: number }> {
    const pool = getPool();
    if (pool) {
      try {
        const [mRes, sRes, eRes] = await Promise.all([
          pool.query('SELECT COUNT(*)::int as count FROM movies'),
          pool.query('SELECT COUNT(*)::int as count FROM series'),
          pool.query('SELECT COUNT(*)::int as count FROM episodes'),
        ]);
        return {
          totalMovies: mRes.rows[0]?.count || 0,
          totalSeries: sRes.rows[0]?.count || 0,
          totalEpisodes: eRes.rows[0]?.count || 0,
        };
      } catch {
        return {
          totalMovies: inMemoryMovies.size,
          totalSeries: inMemorySeries.size,
          totalEpisodes: inMemoryEpisodes.size,
        };
      }
    }
    return {
      totalMovies: inMemoryMovies.size,
      totalSeries: inMemorySeries.size,
      totalEpisodes: inMemoryEpisodes.size,
    };
  }

  /**
   * Heal or purge all dead streams from movies & episodes
   * 1. Heals items where stream_url is dead by promoting a working server from servers JSONB
   * 2. Purges items that have zero working servers
   */
  async healAndPurgeDeadVod(): Promise<{ moviesHealed: number; moviesDeleted: number; episodesDeleted: number }> {
    const pool = getPool();
    if (!pool) return { moviesHealed: 0, moviesDeleted: 0, episodesDeleted: 0 };

    try {
      // 1. Try to heal movies where stream_url is dead by selecting first working server from servers JSONB
      const healRes = await pool.query(`
        UPDATE movies
        SET stream_url = sub.working_url, updated_at = NOW()
        FROM (
          SELECT id, (
            SELECT elem->>'url'
            FROM jsonb_array_elements(servers) as elem
            WHERE elem->>'url' IS NOT NULL
              AND elem->>'url' NOT ILIKE '%dood%'
              AND elem->>'url' NOT ILIKE '%d0o0d%'
              AND elem->>'url' NOT ILIKE '%d0000d%'
              AND elem->>'url' NOT ILIKE '%do0od%'
              AND elem->>'url' NOT ILIKE '%mystream%'
              AND elem->>'url' NOT ILIKE '%dsvplay%'
              AND elem->>'url' NOT ILIKE '%ds2play%'
              AND elem->>'url' NOT ILIKE '%vidbem%'
              AND elem->>'url' NOT ILIKE '%gamescdn%'
              AND elem->>'url' NOT ILIKE '%mixdrop%'
              AND elem->>'url' NOT ILIKE '%mxdrop%'
              AND (
                elem->>'url' ILIKE '%71stream%'
                OR elem->>'url' ILIKE '%ult4vid%'
                OR elem->>'url' ILIKE '%morencius%'
                OR elem->>'url' ILIKE '%minochinos%'
                OR elem->>'url' ILIKE '%callistanise%'
                OR elem->>'url' ILIKE '%vidmoly%'
                OR elem->>'url' ILIKE '%hgcloud%'
                OR elem->>'url' ILIKE '%vidtube%'
                OR elem->>'url' ILIKE '%ok.ru%'
                OR elem->>'url' ILIKE '%.m3u8%'
                OR elem->>'url' ILIKE '%.mp4%'
              )
            LIMIT 1
          ) as working_url
          FROM movies
          WHERE stream_url ILIKE '%dood%'
             OR stream_url ILIKE '%d0o0d%'
             OR stream_url ILIKE '%d0000d%'
             OR stream_url ILIKE '%do0od%'
             OR stream_url ILIKE '%mystream%'
             OR stream_url ILIKE '%dsvplay%'
             OR stream_url ILIKE '%ds2play%'
             OR stream_url ILIKE '%vidbem%'
             OR stream_url ILIKE '%gamescdn%'
             OR stream_url ILIKE '%mixdrop%'
             OR stream_url ILIKE '%mxdrop%'
        ) sub
        WHERE movies.id = sub.id AND sub.working_url IS NOT NULL;
      `);

      const moviesHealed = healRes.rowCount || 0;

      // 2. Heal episodes with bad streams if they have an alternate working server
      const epHealRes = await pool.query(`
        UPDATE episodes
        SET stream_url = sub.working_url
        FROM (
          SELECT episodes.id, (
            SELECT elem->>'url'
            FROM jsonb_array_elements(servers) as elem
            WHERE elem->>'url' IS NOT NULL
              AND elem->>'url' NOT ILIKE '%dood%'
              AND elem->>'url' NOT ILIKE '%mystream%'
              AND elem->>'url' NOT ILIKE '%dsvplay%'
              AND elem->>'url' NOT ILIKE '%gamescdn%'
              AND elem->>'url' NOT ILIKE '%mixdrop%'
              AND elem->>'url' NOT ILIKE '%mxdrop%'
              AND (
                elem->>'url' ILIKE '%71stream%'
                OR elem->>'url' ILIKE '%ult4vid%'
                OR elem->>'url' ILIKE '%morencius%'
                OR elem->>'url' ILIKE '%vidmoly%'
                OR elem->>'url' ILIKE '%.m3u8%'
                OR elem->>'url' ILIKE '%.mp4%'
              )
            LIMIT 1
          ) as working_url
          FROM episodes
          WHERE stream_url ILIKE '%dood%'
             OR stream_url ILIKE '%mystream%'
             OR stream_url ILIKE '%dsvplay%'
             OR stream_url ILIKE '%gamescdn%'
             OR stream_url ILIKE '%mixdrop%'
             OR stream_url ILIKE '%mxdrop%'
        ) sub
        WHERE episodes.id = sub.id AND sub.working_url IS NOT NULL;
      `);

      // 3. Delete remaining movies with completely dead streams
      const mRes = await pool.query(`
        DELETE FROM movies
        WHERE stream_url ILIKE '%dood%'
           OR stream_url ILIKE '%d0o0d%'
           OR stream_url ILIKE '%d0000d%'
           OR stream_url ILIKE '%do0od%'
           OR stream_url ILIKE '%dooood%'
           OR stream_url ILIKE '%mystream%'
           OR stream_url ILIKE '%dsvplay%'
           OR stream_url ILIKE '%ds2play%'
           OR stream_url ILIKE '%ds2video%'
           OR stream_url ILIKE '%vidbem%'
           OR stream_url ILIKE '%vidshar%'
           OR stream_url ILIKE '%vidbam%'
           OR stream_url ILIKE '%goved%'
           OR stream_url ILIKE '%2embed%'
           OR stream_url ILIKE '%fembed%'
           OR stream_url ILIKE '%youtube.com%'
           OR stream_url ILIKE '%5drama%'
           OR stream_url ILIKE '%5tv.asia%'
           OR stream_url ILIKE '%5tv.fun%'
           OR stream_url ILIKE '%5tv.lol%'
           OR stream_url ILIKE '%topcinema.io%'
           OR stream_url ILIKE '%gamescdn.online%'
           OR stream_url ILIKE '%moshahda.net%'
           OR stream_url ILIKE '%mixdrop%'
           OR stream_url ILIKE '%mxdrop%'
           OR stream_url ILIKE '%upstream%'
           OR stream_url ILIKE '%lulu%'
           OR stream_url ILIKE '%voe.sx%'
           OR stream_url ILIKE '%swhoi%'
      `);

      // 4. Delete remaining episodes with dead streams
      const eRes = await pool.query(`
        DELETE FROM episodes
        WHERE stream_url ILIKE '%dood%'
           OR stream_url ILIKE '%d0o0d%'
           OR stream_url ILIKE '%d0000d%'
           OR stream_url ILIKE '%do0od%'
           OR stream_url ILIKE '%dooood%'
           OR stream_url ILIKE '%mystream%'
           OR stream_url ILIKE '%dsvplay%'
           OR stream_url ILIKE '%ds2play%'
           OR stream_url ILIKE '%ds2video%'
           OR stream_url ILIKE '%vidbem%'
           OR stream_url ILIKE '%vidshar%'
           OR stream_url ILIKE '%vidbam%'
           OR stream_url ILIKE '%goved%'
           OR stream_url ILIKE '%2embed%'
           OR stream_url ILIKE '%fembed%'
           OR stream_url ILIKE '%youtube.com%'
           OR stream_url ILIKE '%5drama%'
           OR stream_url ILIKE '%5tv.asia%'
           OR stream_url ILIKE '%5tv.fun%'
           OR stream_url ILIKE '%5tv.lol%'
           OR stream_url ILIKE '%topcinema.io%'
           OR stream_url ILIKE '%gamescdn.online%'
           OR stream_url ILIKE '%moshahda.net%'
           OR stream_url ILIKE '%mixdrop%'
           OR stream_url ILIKE '%mxdrop%'
           OR stream_url ILIKE '%upstream%'
           OR stream_url ILIKE '%lulu%'
           OR stream_url ILIKE '%voe.sx%'
           OR stream_url ILIKE '%swhoi%'
      `);

      return {
        moviesHealed,
        moviesDeleted: mRes.rowCount || 0,
        episodesDeleted: eRes.rowCount || 0,
      };
    } catch (err: any) {
      console.error('[VodRepository] Error in healAndPurgeDeadVod:', err.message);
      return { moviesHealed: 0, moviesDeleted: 0, episodesDeleted: 0 };
    }
  }

  async purgeInvalidStreams(): Promise<{ moviesDeleted: number; episodesDeleted: number; moviesHealed?: number }> {
    return this.healAndPurgeDeadVod();
  }

  async wipeAllVod(): Promise<{ moviesDeleted: number; seriesDeleted: number; episodesDeleted: number }> {
    const pool = getPool();
    if (pool) {
      try {
        const eRes = await pool.query('DELETE FROM episodes');
        const sRes = await pool.query('DELETE FROM series');
        const mRes = await pool.query('DELETE FROM movies');
        return {
          moviesDeleted: mRes.rowCount || 0,
          seriesDeleted: sRes.rowCount || 0,
          episodesDeleted: eRes.rowCount || 0,
        };
      } catch (err: any) {
        console.error('Error in wipeAllVod:', err.message);
        return { moviesDeleted: 0, seriesDeleted: 0, episodesDeleted: 0 };
      }
    }
    const mCount = inMemoryMovies.size;
    const sCount = inMemorySeries.size;
    const eCount = inMemoryEpisodes.size;
    inMemoryMovies.clear();
    inMemorySeries.clear();
    inMemoryEpisodes.clear();
    return { moviesDeleted: mCount, seriesDeleted: sCount, episodesDeleted: eCount };
  }
}

export const vodRepository = new VodRepository();
