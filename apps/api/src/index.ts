import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import * as path from 'path';
import * as fs from 'fs';
import { config } from './config';
import { initFirebaseAdmin } from './firebase/admin';
import { authRoutes } from './routes/auth.routes';
import { dashboardRoutes } from './routes/dashboard.routes';
import { sourceRoutes } from './routes/source.routes';
import { channelRoutes } from './routes/channel.routes';
import { jobRoutes } from './routes/job.routes';
import { tokenRoutes } from './routes/token.routes';
import { settingsRoutes } from './routes/settings.routes';
import { hlsAuthRoutes } from './routes/hls-auth.routes';
import { tokenRepository } from './repositories/token.repository';
import { hashStreamToken } from './security/token';

export async function createServer() {
  const server = Fastify({
    logger: {
      level: config.nodeEnv === 'production' ? 'info' : 'warn',
    },
    trustProxy: true,
  });

  // Security & Plugins
  await server.register(cors, {
    origin: [config.webBaseUrl, 'http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  await server.register(cookie, {
    secret: config.sessionSecret,
    hook: 'onRequest',
  });

  await server.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
  });

  // Initialize Firebase Admin
  initFirebaseAdmin();

  // Register API Routes
  await server.register(authRoutes, { prefix: '/api/auth' });
  await server.register(dashboardRoutes, { prefix: '/api/dashboard' });
  await server.register(sourceRoutes, { prefix: '/api/sources' });
  await server.register(channelRoutes, { prefix: '/api/channels' });
  await server.register(jobRoutes, { prefix: '/api/jobs' });
  await server.register(tokenRoutes, { prefix: '/api/stream-tokens' });
  await server.register(settingsRoutes, { prefix: '/api' });
  await server.register(hlsAuthRoutes, { prefix: '/api' });

  // Direct HLS Static Serving Handler for local development / testing without Nginx
  // Verifies the stream token on every playlist (.m3u8) and segment (.ts) request!
  server.get('/hls/:outputId/:token/:file', async (request, reply) => {
    const { outputId, token: rawToken, file } = request.params as {
      outputId: string;
      token: string;
      file: string;
    };

    // Sanitize filename to prevent directory traversal
    const safeFile = path.basename(file);
    if (!safeFile || safeFile !== file) {
      return reply.status(400).send('Invalid filename');
    }

    // Verify token
    const tokenHash = hashStreamToken(rawToken);
    const tokenDoc = await tokenRepository.getTokenByHash(tokenHash);

    if (!tokenDoc || tokenDoc.publicOutputId !== outputId) {
      return reply.status(403).send('Forbidden: Invalid stream token or output');
    }

    if (tokenDoc.revokedAt) {
      return reply.status(403).send('Forbidden: Token has been revoked');
    }

    if (tokenDoc.expiresAt && Date.now() > new Date(tokenDoc.expiresAt).getTime()) {
      return reply.status(403).send('Forbidden: Token has expired');
    }

    // Update last used asynchronously
    tokenRepository.updateLastUsed(tokenDoc.id).catch(() => {});

    const filePath = path.resolve(config.streamStoragePath, outputId, safeFile);

    if (!fs.existsSync(filePath)) {
      return reply.status(404).send('Stream file not found or not yet generated');
    }

    // Set appropriate MIME types and cache headers
    if (safeFile.endsWith('.m3u8')) {
      reply.header('Content-Type', 'application/vnd.apple.mpegurl');
      reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (safeFile.endsWith('.ts')) {
      reply.header('Content-Type', 'video/mp2t');
      reply.header('Cache-Control', 'public, max-age=86400');
    }

    reply.header('Access-Control-Allow-Origin', '*');
    const stream = fs.createReadStream(filePath);
    return reply.send(stream);
  });

  return server;
}

async function start() {
  const server = await createServer();
  try {
    await server.listen({ port: config.port, host: config.host });
    console.log(`[Aspreen TV API] Server running at http://${config.host}:${config.port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}
