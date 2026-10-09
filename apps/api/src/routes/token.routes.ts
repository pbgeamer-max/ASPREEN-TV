import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAdminAuth } from '../security/auth-guard';
import { tokenRepository } from '../repositories/token.repository';
import { channelRepository } from '../repositories/channel.repository';
import { settingsRepository } from '../repositories/settings.repository';
import { logRepository } from '../repositories/log.repository';
import { StreamTokenCreateSchema } from '@aspreen/shared';
import { generateStreamToken, hashStreamToken, buildPlaybackUrl, buildTsPlaybackUrl } from '../security/token';

export async function tokenRoutes(server: FastifyInstance) {
  server.addHook('preHandler', requireAdminAuth);

  /**
   * GET /api/stream-tokens
   */
  server.get('/', async (request: FastifyRequest<{ Querystring: { channelId?: string } }>) => {
    return tokenRepository.listTokens(request.query.channelId);
  });

  /**
   * POST /api/channels/:id/tokens
   * Creates a protected playback token. Returns the raw bearer token and URL ONLY ONCE.
   */
  server.post('/channels/:id/tokens', async (request: FastifyRequest<{
    Params: { id: string };
    Body: unknown;
  }>, reply: FastifyReply) => {
    const channel = await channelRepository.getChannel(request.params.id);
    if (!channel) {
      return reply.status(404).send({ error: 'Channel not found' });
    }

    const parseResult = StreamTokenCreateSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation Error', details: parseResult.error.format() });
    }

    const settings = await settingsRepository.getSettings();
    const rawToken = generateStreamToken();
    const tokenHash = hashStreamToken(rawToken);

    // Calculate expiration if requested
    let expiresAt: string | undefined;
    const lifetimeHours = parseResult.data.lifetimeHours || settings.defaultTokenLifetime;
    if (lifetimeHours > 0) {
      const expDate = new Date();
      expDate.setHours(expDate.getHours() + lifetimeHours);
      expiresAt = expDate.toISOString();
    }

    const publicOutputId = channel.activeOutputId || channel.id;

    const tokenDoc = await tokenRepository.createToken({
      channelId: channel.id,
      name: parseResult.data.name,
      tokenHash,
      publicOutputId,
      expiresAt,
    });

    let effectiveBaseUrl = settings.publicStreamBaseUrl;
    const reqHost = (request.headers['x-forwarded-host'] as string) || (request.headers.host as string);
    const reqProto = (request.headers['x-forwarded-proto'] as string) || 'https';
    if ((!effectiveBaseUrl || effectiveBaseUrl.includes('localhost') || effectiveBaseUrl.includes('@')) && reqHost && !reqHost.includes('127.0.0.1')) {
      effectiveBaseUrl = `${reqProto}://${reqHost}`;
    }

    const playbackUrl = buildPlaybackUrl(effectiveBaseUrl, publicOutputId, rawToken);
    const tsPlaybackUrl = buildTsPlaybackUrl(effectiveBaseUrl, publicOutputId, rawToken);

    await logRepository.addLog({
      eventType: 'TOKEN_CREATED',
      entityType: 'STREAM_TOKEN',
      entityId: tokenDoc.id,
      result: 'SUCCESS',
      safeDetails: {
        channelId: channel.id,
        channelName: channel.name,
        tokenName: tokenDoc.name,
        expiresAt,
      },
    });

    return reply.status(201).send({
      token: tokenDoc,
      rawToken, // Only returned at generation time!
      playbackUrl,
      tsPlaybackUrl,
    });
  });

  /**
   * DELETE /api/stream-tokens/:id
   * Revokes token
   */
  server.delete('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const revoked = await tokenRepository.revokeToken(request.params.id);
    if (!revoked) {
      return reply.status(404).send({ error: 'Token not found' });
    }

    await logRepository.addLog({
      eventType: 'TOKEN_REVOKED',
      entityType: 'STREAM_TOKEN',
      entityId: request.params.id,
      result: 'SUCCESS',
      safeDetails: { tokenId: request.params.id },
    });

    return { success: true };
  });

  /**
   * POST /api/stream-tokens/:id/rotate
   * Revokes old token and generates a new active token with same name and channel
   */
  server.post('/:id/rotate', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const existing = await tokenRepository.getToken(request.params.id);
    if (!existing) {
      return reply.status(404).send({ error: 'Token not found' });
    }

    // Revoke old token
    await tokenRepository.revokeToken(existing.id);

    const settings = await settingsRepository.getSettings();
    const rawToken = generateStreamToken();
    const tokenHash = hashStreamToken(rawToken);

    const newToken = await tokenRepository.createToken({
      channelId: existing.channelId,
      name: `${existing.name} (Rotated)`,
      tokenHash,
      publicOutputId: existing.publicOutputId,
      expiresAt: existing.expiresAt,
    });

    let effectiveBaseUrl = settings.publicStreamBaseUrl;
    const reqHost = (request.headers['x-forwarded-host'] as string) || (request.headers.host as string);
    const reqProto = (request.headers['x-forwarded-proto'] as string) || 'https';
    if ((!effectiveBaseUrl || effectiveBaseUrl.includes('localhost')) && reqHost && !reqHost.includes('127.0.0.1')) {
      effectiveBaseUrl = `${reqProto}://${reqHost}`;
    }

    const playbackUrl = buildPlaybackUrl(effectiveBaseUrl, existing.publicOutputId, rawToken);
    const tsPlaybackUrl = buildTsPlaybackUrl(effectiveBaseUrl, existing.publicOutputId, rawToken);

    return {
      token: newToken,
      rawToken,
      playbackUrl,
      tsPlaybackUrl,
    };
  });
}
