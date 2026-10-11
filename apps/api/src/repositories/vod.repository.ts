import * as crypto from 'crypto';
import { getPool } from '../db';

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
          description, release_year, rating, stream_url, container_extension, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (normalized_title) DO UPDATE SET
          category = EXCLUDED.category,
          poster_url = COALESCE(EXCLUDED.poster_url, movies.poster_url),
          backdrop_url = COALESCE(EXCLUDED.backdrop_url, movies.backdrop_url),
          description = COALESCE(EXCLUDED.description, movies.description),
          release_year = COALESCE(EXCLUDED.release_year, movies.release_year),
          rating = COALESCE(EXCLUDED.rating, movies.rating),
          stream_url = EXCLUDED.stream_url,
          container_extension = EXCLUDED.container_extension,
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
        items: rowsRes.rows.map(this.mapMovieRow),
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
          poster_url, description, stream_url, container_extension, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (series_id, season_num, episode_num) DO UPDATE SET
          title = EXCLUDED.title,
          poster_url = COALESCE(EXCLUDED.poster_url, episodes.poster_url),
          description = COALESCE(EXCLUDED.description, episodes.description),
          stream_url = EXCLUDED.stream_url,
          container_extension = EXCLUDED.container_extension
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

  private mapMovieRow(r: any): Movie {
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
    return {
      id: r.id,
      seriesId: r.series_id,
      seasonNum: Number(r.season_num || 1),
      episodeNum: Number(r.episode_num || 1),
      title: r.title,
      posterUrl: r.poster_url || undefined,
      description: r.description || undefined,
      streamUrl: r.stream_url,
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

  async purgeInvalidStreams(): Promise<{ moviesDeleted: number; episodesDeleted: number }> {
    const pool = getPool();
    if (pool) {
      try {
        const epRes = await pool.query(
          `DELETE FROM episodes WHERE stream_url ILIKE '%5tv.lol%' OR stream_url ILIKE '%topcinema.io%'`
        );
        const mRes = await pool.query(
          `DELETE FROM movies WHERE stream_url ILIKE '%5tv.lol%' OR stream_url ILIKE '%topcinema.io%'`
        );
        return {
          moviesDeleted: mRes.rowCount || 0,
          episodesDeleted: epRes.rowCount || 0,
        };
      } catch (err: any) {
        console.error('Error in purgeInvalidStreams:', err.message);
        return { moviesDeleted: 0, episodesDeleted: 0 };
      }
    }
    return { moviesDeleted: 0, episodesDeleted: 0 };
  }
}

export const vodRepository = new VodRepository();
