import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { tokenRepository } from '../repositories/token.repository';
import { hashStreamToken } from '../security/token';
import { transcodingService } from '../services/transcoding.service';

export async function hlsAuthRoutes(server: FastifyInstance) {
  /**
   * GET /api/hls-auth
   * Subrequest authorization validator used by Nginx auth_request.
   * Protects both master/media .m3u8 playlists and all .ts media segments!
   */
  server.get('/hls-auth', async (request: FastifyRequest, reply: FastifyReply) => {
    // 1. Inspect X-Original-URI header passed by Nginx
    const originalUri = (request.headers['x-original-uri'] as string) || request.url;

    // Pattern: /hls/{outputId}/{token}/...
    const match = originalUri.match(/\/hls\/([a-zA-Z0-9_\-]+)\/([a-fA-F0-9]{32,64})\//);

    let outputId: string | undefined;
    let rawToken: string | undefined;

    if (match) {
      outputId = match[1];
      rawToken = match[2];
    } else {
      // Fallback to query params if configured that way
      const query = request.query as { token?: string; outputId?: string };
      outputId = query.outputId;
      rawToken = query.token;
    }

    if (!outputId || !rawToken) {
      return reply.status(403).send('Forbidden: Missing stream token or output ID');
    }

    // 2. Hash raw token
    const tokenHash = hashStreamToken(rawToken);

    // 3. Query Firestore
    const token = await tokenRepository.getTokenByHash(tokenHash);

    if (!token) {
      return reply.status(403).send('Forbidden: Invalid stream token');
    }

    // 4. Verify output association
    if (token.publicOutputId !== outputId) {
      return reply.status(403).send('Forbidden: Token does not match requested output stream');
    }

    // 5. Verify not revoked
    if (token.revokedAt) {
      return reply.status(403).send('Forbidden: Stream token has been revoked');
    }

    // 6. Verify not expired
    if (token.expiresAt) {
      const exp = new Date(token.expiresAt).getTime();
      if (Date.now() > exp) {
        return reply.status(403).send('Forbidden: Stream token has expired');
      }
    }

    // 7. Update last used in background (do not block media streaming response)
    tokenRepository.updateLastUsed(token.id).catch(() => {});
    transcodingService.touchChannelAccess(token.channelId);

    // Auto-trigger on-demand segmentation if playlist is requested
    if (originalUri.includes('.m3u8')) {
      transcodingService.ensureChannelRunning(token.channelId).catch(() => {});
    }

    return reply.status(200).send('OK');
  });
}

