import { FastifyInstance, FastifyRequest } from 'fastify';
import { vodRepository } from '../repositories/vod.repository';
import { vodService } from '../services/vod.service';

export async function vodRoutes(server: FastifyInstance) {
  /**
   * GET /api/vod/movies
   * Returns paginated list of movies with category filter & search
   */
  server.get(
    '/movies',
    async (
      request: FastifyRequest<{
        Querystring: { category?: string; q?: string; limit?: string; offset?: string };
      }>
    ) => {
      const { category, q, limit, offset } = request.query;
      const limitNum = limit ? parseInt(limit, 10) : 50;
      const offsetNum = offset ? parseInt(offset, 10) : 0;

      const result = await vodRepository.listMovies(category, q, limitNum, offsetNum);
      const categories = await vodRepository.getDistinctMovieCategories();

      return {
        total: result.total,
        limit: limitNum,
        offset: offsetNum,
        categories,
        items: result.items,
      };
    }
  );

  /**
   * GET /api/vod/series
   * Returns paginated list of TV series with category filter & search
   */
  server.get(
    '/series',
    async (
      request: FastifyRequest<{
        Querystring: { category?: string; q?: string; limit?: string; offset?: string };
      }>
    ) => {
      const { category, q, limit, offset } = request.query;
      const limitNum = limit ? parseInt(limit, 10) : 50;
      const offsetNum = offset ? parseInt(offset, 10) : 0;

      const result = await vodRepository.listSeries(category, q, limitNum, offsetNum);
      const categories = await vodRepository.getDistinctSeriesCategories();

      return {
        total: result.total,
        limit: limitNum,
        offset: offsetNum,
        categories,
        items: result.items,
      };
    }
  );

  /**
   * GET /api/vod/series/:id
   * Returns a single series with all seasons and episodes in order
   */
  server.get('/series/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const { id } = request.params;
    const series = await vodRepository.getSeriesWithEpisodes(id);
    if (!series) {
      return reply.status(404).send({ error: 'Series not found' });
    }
    return series;
  });

  /**
   * GET /api/vod/categories
   * Returns distinct categories for movies and series
   */
  server.get('/categories', async () => {
    const movieCategories = await vodRepository.getDistinctMovieCategories();
    const seriesCategories = await vodRepository.getDistinctSeriesCategories();
    return {
      movieCategories,
      seriesCategories,
    };
  });

  /**
   * POST /api/vod/sync
   * Runs the VOD scraper engine to sync movies and series without duplicates
   */
  server.post('/sync', async () => {
    const report = await vodService.syncAllVod();
    return {
      success: true,
      report,
    };
  });

  /**
   * POST /api/vod/topcinema-sync
   * Dedicated TopCinema crawler trigger
   */
  server.post(
    '/topcinema-sync',
    async (
      request: FastifyRequest<{
        Body?: { maxMoviePages?: number; maxSeries?: number; recentLimit?: number };
      }>
    ) => {
      const { maxMoviePages, maxSeries, recentLimit } = request.body || {};
      const { topCinemaService } = await import('../services/topcinema.service');
      const report = await topCinemaService.syncTopCinema({
        maxMoviePages: maxMoviePages || 3,
        maxSeries: maxSeries || 15,
        recentLimit: recentLimit || 40,
      });
      return {
        success: true,
        report,
      };
    }
  );
}
