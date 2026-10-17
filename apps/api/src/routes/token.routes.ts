import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAdminAuth } from '../security/auth-guard';
import { tokenRepository } from '../repositories/token.repository';
import { channelRepository } from '../repositories/channel.repository';
import { settingsRepository } from '../repositories/settings.repository';
import { logRepository } from '../repositories/log.repository';
import { StreamTokenCreateSchema, ExportLinksSchema, ExportedChannelItem, ExportLinksResult } from '@aspreen/shared';
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

  /**
   * POST /api/stream-tokens/export-links
   * Generates valid playback tokens and formats all enabled channels for TXT / M3U export.
   */
  server.post('/export-links', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = ExportLinksSchema.safeParse(request.body || {});
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation Error', details: parseResult.error.format() });
    }

    const { sourceId, tokenLifetimeHours } = parseResult.data;
    const settings = await settingsRepository.getSettings();

    let effectiveBaseUrl = settings.publicStreamBaseUrl;
    const reqHost = (request.headers['x-forwarded-host'] as string) || (request.headers.host as string);
    const reqProto = (request.headers['x-forwarded-proto'] as string) || 'https';
    if ((!effectiveBaseUrl || effectiveBaseUrl.includes('localhost') || effectiveBaseUrl.includes('@')) && reqHost && !reqHost.includes('127.0.0.1')) {
      effectiveBaseUrl = `${reqProto}://${reqHost}`;
    }

    const channels = await channelRepository.listChannels(sourceId);
    const enabledChannels = channels.filter((c) => c.enabled !== false);

    const exportedItems: ExportedChannelItem[] = [];

    let expiresAt: string | undefined;
    const lifetime = tokenLifetimeHours || settings.defaultTokenLifetime;
    if (lifetime > 0) {
      const expDate = new Date();
      expDate.setHours(expDate.getHours() + lifetime);
      expiresAt = expDate.toISOString();
    }

    const tokensToCreate: any[] = [];

    for (const channel of enabledChannels) {
      const publicOutputId = channel.activeOutputId || channel.id;
      const rawToken = generateStreamToken();
      const tokenHash = hashStreamToken(rawToken);

      tokensToCreate.push({
        channelId: channel.id,
        name: `Export Token - ${channel.name}`,
        tokenHash,
        publicOutputId,
        expiresAt,
      });

      const playbackUrl = buildPlaybackUrl(effectiveBaseUrl, publicOutputId, rawToken);
      const tsPlaybackUrl = buildTsPlaybackUrl(effectiveBaseUrl, publicOutputId, rawToken);

      exportedItems.push({
        id: channel.id,
        name: channel.name,
        groupTitle: channel.groupTitle || 'General',
        logoUrl: channel.logoUrl,
        playbackUrl,
        tsPlaybackUrl,
      });
    }

    // High-performance batch insertion into PostgreSQL / Firestore
    await tokenRepository.createTokensBatch(tokensToCreate);

    // Generate formatted TXT file
    const now = new Date().toISOString();
    const txtLines: string[] = [
      '================================================================================',
      '  ASPREEN TV — WORKING CHANNELS EXPORT',
      `  Generated: ${now}`,
      `  Total Channels: ${exportedItems.length}`,
      `  Streaming Server: ${effectiveBaseUrl}`,
      '================================================================================\n',
    ];

    for (let index = 0; index < exportedItems.length; index++) {
      const item = exportedItems[index];
      txtLines.push(`[${index + 1}] ${item.name}`);
      if (item.groupTitle) txtLines.push(`Category: ${item.groupTitle}`);
      txtLines.push(`HLS Stream (.m3u8): ${item.playbackUrl}`);
      txtLines.push('--------------------------------------------------------------------------------');
    }
    const txtContent = txtLines.join('\n');

    // Generate standard M3U playlist file (Strictly pure M3U8 URLs)
    const m3uLines: string[] = ['#EXTM3U'];
    for (const item of exportedItems) {
      const tvgLogo = item.logoUrl ? ` tvg-logo="${item.logoUrl}"` : '';
      const groupTitle = item.groupTitle ? ` group-title="${item.groupTitle.replace(/"/g, "'")}"` : '';
      m3uLines.push(`#EXTINF:-1 tvg-id="" tvg-name="${item.name.replace(/"/g, "'")}"${tvgLogo}${groupTitle},${item.name}`);
      m3uLines.push(item.playbackUrl);
    }
    const m3uContent = m3uLines.join('\n');

    await logRepository.addLog({
      eventType: 'CHANNELS_EXPORTED',
      entityType: 'STREAM_TOKEN',
      result: 'SUCCESS',
      safeDetails: {
        sourceId,
        channelCount: exportedItems.length,
      },
    });

    const result: ExportLinksResult = {
      totalChannels: exportedItems.length,
      channels: exportedItems,
      txtContent,
      m3uContent,
    };

    return result;
  });

  /**
   * GET /api/stream-tokens/download-export
   * Direct download endpoint for TXT and M3U files.
   */
  server.get('/download-export', async (request: FastifyRequest<{
    Querystring: { format?: 'txt' | 'm3u'; sourceId?: string };
  }>, reply: FastifyReply) => {
    const format = request.query.format === 'm3u' ? 'm3u' : 'txt';
    const sourceId = request.query.sourceId;

    const res = await (server as any).inject({
      method: 'POST',
      url: '/api/stream-tokens/export-links',
      headers: {
        authorization: request.headers.authorization,
        cookie: request.headers.cookie,
      },
      payload: { sourceId },
    });

    if (res.statusCode !== 200) {
      return reply.status(res.statusCode).send(res.body);
    }

    const data: ExportLinksResult = JSON.parse(res.body);
    const filename = `aspreen_channels_${new Date().toISOString().slice(0, 10)}.${format}`;

    if (format === 'm3u') {
      reply.header('Content-Type', 'audio/x-mpegurl; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(data.m3uContent);
    } else {
      reply.header('Content-Type', 'text/plain; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(data.txtContent);
    }
  });
}

