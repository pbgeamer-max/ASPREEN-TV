import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAdminAuth } from '../security/auth-guard';
import { sourceRepository } from '../repositories/source.repository';
import { channelRepository } from '../repositories/channel.repository';
import { sourceService } from '../services/source.service';
import { SourceCreateSchema, SourceUpdateSchema } from '@aspreen/shared';
import { validateUrlSsrf } from '@aspreen/shared/dist/server';
import { decrypt } from '../security/encryption';

export async function sourceRoutes(server: FastifyInstance) {
  server.addHook('preHandler', requireAdminAuth);

  /**
   * Helper to strip encrypted internal secrets from API responses
   */
  function sanitizeSource(src: any) {
    const { encryptedUrl, encryptedCredentials, ...rest } = src;
    return rest;
  }

  /**
   * GET /api/sources
   */
  server.get('/', async (_request: FastifyRequest) => {
    const sources = await sourceRepository.listSources();
    return sources.map(sanitizeSource);
  });

  /**
   * POST /api/sources
   */
  server.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = SourceCreateSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        details: parseResult.error.format(),
      });
    }

    try {
      const result = await sourceService.addSource(parseResult.data);
      return reply.status(201).send({
        source: sanitizeSource(result.source),
        importedChannels: result.importedChannels,
      });
    } catch (err: any) {
      return reply.status(400).send({
        error: 'Failed to add source',
        message: err.message,
      });
    }
  });

  /**
   * GET /api/sources/:id
   */
  server.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const source = await sourceRepository.getSource(request.params.id);
    if (!source) {
      return reply.status(404).send({ error: 'Source not found' });
    }
    return sanitizeSource(source);
  });

  /**
   * PATCH /api/sources/:id
   */
  server.patch('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const parseResult = SourceUpdateSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation Error', details: parseResult.error.format() });
    }

    const updated = await sourceRepository.updateSource(request.params.id, parseResult.data);
    if (!updated) {
      return reply.status(404).send({ error: 'Source not found' });
    }
    return sanitizeSource(updated);
  });

  /**
   * DELETE /api/sources/:id
   */
  server.delete('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const success = await sourceRepository.deleteSource(request.params.id);
    if (!success) {
      return reply.status(404).send({ error: 'Source not found' });
    }

    // Cascade delete associated channels
    await channelRepository.deleteChannelsBySourceId(request.params.id);

    return { success: true };
  });

  /**
   * POST /api/sources/:id/validate
   */
  server.post('/:id/validate', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const source = await sourceRepository.getSource(request.params.id);
    if (!source) {
      return reply.status(404).send({ error: 'Source not found' });
    }

    if (!source.encryptedUrl) {
      return { isValid: true, type: source.type, message: 'Local source validated' };
    }

    const rawUrl = decrypt(source.encryptedUrl);
    const ssrfResult = await validateUrlSsrf(rawUrl);

    return {
      isValid: ssrfResult.isValid,
      hostname: ssrfResult.sanitizedHostname,
      error: ssrfResult.errorMessage,
    };
  });

  /**
   * POST /api/sources/:id/refresh
   */
  server.post('/:id/refresh', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const stats = await sourceService.refreshSource(request.params.id);
      return stats;
    } catch (err: any) {
      return reply.status(400).send({ error: 'Refresh failed', message: err.message });
    }
  });
}
