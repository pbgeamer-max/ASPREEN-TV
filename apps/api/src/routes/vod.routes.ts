import { FastifyInstance, FastifyRequest } from 'fastify';
import { vodRepository } from '../repositories/vod.repository';
import { vodService } from '../services/vod.service';
import { topCinemaService } from '../services/topcinema.service';
import { fiveTvService } from '../services/fivetv.service';
import { streamResolverService } from '../services/stream-resolver.service';

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
      const report = await topCinemaService.syncTopCinema({
        maxMoviePages: maxMoviePages || 8,
        maxSeries: maxSeries || 30,
        recentLimit: recentLimit || 50,
      });
      return {
        success: true,
        report,
      };
    }
  );

  /**
   * POST /api/vod/fivetv-sync
   * Dedicated FiveTV crawler trigger
   */
  server.post(
    '/fivetv-sync',
    async (
      request: FastifyRequest<{
        Body?: { maxMoviePages?: number; maxSeriesPages?: number; recentLimit?: number; deep?: boolean };
      }>
    ) => {
      const { maxMoviePages, maxSeriesPages, recentLimit, deep } = request.body || {};
      const report = await fiveTvService.syncFiveTv({
        deep: !!deep,
        maxMoviePages: maxMoviePages || (deep ? 15 : 6),
        maxSeriesPages: maxSeriesPages || (deep ? 10 : 4),
        recentLimit: recentLimit || (deep ? 60 : 30),
      });
      return {
        success: true,
        report,
      };
    }
  );

  /**
   * POST /api/vod/full-sync
   * Deep multi-provider sync across FiveTV and TopCinema
   */
  server.post(
    '/full-sync',
    async (
      request: FastifyRequest<{
        Body?: { deep?: boolean };
      }>
    ) => {
      const { deep } = request.body || {};
      const fivetvReport = await fiveTvService.syncFiveTv({ deep: !!deep });
      const topcinemaReport = await topCinemaService.syncTopCinema({ deep: !!deep });
      const stats = await vodRepository.getStats();

      return {
        success: true,
        report: {
          fivetv: fivetvReport,
          topcinema: topcinemaReport,
          totalMovies: stats.totalMovies,
          totalSeries: stats.totalSeries,
          totalEpisodes: stats.totalEpisodes,
        },
      };
    }
  );

  /**
   * POST /api/vod/deep-sync
   * True unlimited background crawl from A to Z across all pages of FiveTV & TopCinema
   */
  server.post(
    '/deep-sync',
    async (request: FastifyRequest<{ Body?: { unlimited?: boolean } }>, reply) => {
      // First clean any bad links in background
      vodRepository.purgeInvalidStreams().then(async (cleanRes) => {
        console.log(`[DeepSync] Cleaned invalid links: ${cleanRes.moviesDeleted} movies, ${cleanRes.episodesDeleted} episodes`);
        console.log('[DeepSync] Starting unlimited FiveTV crawl...');
        await fiveTvService.syncFiveTv({ unlimited: true });
        console.log('[DeepSync] Starting unlimited TopCinema crawl...');
        await topCinemaService.syncTopCinema({ unlimited: true });
        console.log('[DeepSync] Completed full deep ingestion!');
      }).catch(err => {
        console.error('[DeepSync] Error during background ingestion:', err.message);
      });

      return reply.send({
        success: true,
        message: '🚀 بدأ سحب المكتبات بالكامل من الألف إلى الياء في الخلفية (بدون حدود صفحات)! يتم استخراج روابط التشغيل النظيفة فقط وحذف روابط المواقع.',
      });
    }
  );

  /**
   * POST /api/vod/clean
   * Delete any broken or website-page stream links so they get re-ingested cleanly
   */
  server.post('/clean', async () => {
    const result = await vodRepository.purgeInvalidStreams();
    return {
      success: true,
      result,
    };
  });

  /**
   * GET /api/vod/resolve-stream
   * Resolve embed URLs (like 71stream) to direct media file for direct HTML5 player
   */
  server.get(
    '/resolve-stream',
    async (request: FastifyRequest<{ Querystring: { url: string } }>, reply) => {
      const { url } = request.query;
      if (!url) {
        return reply.status(400).send({ error: 'URL parameter is required' });
      }

      const resolved = await streamResolverService.resolveDirectStream(url);
      if (resolved.directUrl) {
        return {
          directUrl: resolved.directUrl,
          title: resolved.title,
        };
      }

      return { directUrl: url };
    }
  );

  /**
   * GET /api/vod/stats
   * Returns current VOD stats
   */
  server.get('/stats', async () => {
    return await vodRepository.getStats();
  });
}

