import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
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
import { channelRepository } from './repositories/channel.repository';
import { hashStreamToken } from './security/token';
import { decrypt } from './security/encryption';

export async function createServer() {
  const server = Fastify({
    logger: {
      level: config.nodeEnv === 'production' ? 'info' : 'warn',
    },
    trustProxy: true,
  });

  // Security & Plugins
  await server.register(cors, {
    origin: true,
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

  // Gracefully handle empty JSON bodies from proxies/rewrites
  server.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, defaultDone) => {
    if (!body || (typeof body === 'string' && body.trim() === '')) {
      defaultDone(null, {});
      return;
    }
    try {
      defaultDone(null, JSON.parse(body as string));
    } catch (err: any) {
      defaultDone(err, null);
    }
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

  // Helper function to stream live MPEG-TS relay using FFmpeg
  async function streamLiveMpegTs(
    outputId: string,
    rawToken: string,
    request: any,
    reply: any
  ) {
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

    tokenRepository.updateLastUsed(tokenDoc.id).catch(() => {});

    const channel = await channelRepository.getChannel(tokenDoc.channelId);
    if (!channel || !channel.enabled) {
      return reply.status(404).send('Channel not found or disabled');
    }

    const inputUrl = decrypt(channel.encryptedInputUrl);
    if (!inputUrl) {
      return reply.status(500).send('Unable to decrypt channel stream input');
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'video/mp2t',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel', 'warning',
      '-protocol_whitelist', 'file,crypto,data,http,https,tcp,tls',
      '-fflags', '+genpts+discardcorrupt',
      '-err_detect', 'ignore_err',
    ];

    if (/^https?:\/\//i.test(inputUrl)) {
      ffmpegArgs.push(
        '-user_agent', 'VLC/3.0.20 LibVLC/3.0.20',
        '-reconnect', '1',
        '-reconnect_at_eof', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '2',
        '-timeout', '10000000'
      );
    }

    ffmpegArgs.push('-i', inputUrl);
    ffmpegArgs.push('-avoid_negative_ts', 'make_zero');
    ffmpegArgs.push('-c', 'copy', '-f', 'mpegts', 'pipe:1');

    const proc = spawn('ffmpeg', ffmpegArgs, { windowsHide: true });
    proc.stdout.pipe(reply.raw);

    const cleanup = () => {
      try {
        proc.kill('SIGTERM');
      } catch {}
    };

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
    proc.on('error', () => {
      try { reply.raw.end(); } catch {}
    });
  }

  // Direct Live MPEG-TS Relay endpoint (/live/:outputId/:token.ts or /live/:outputId/:token)
  server.get('/live/:outputId/:token', async (request, reply) => {
    let { outputId, token: rawToken } = request.params as {
      outputId: string;
      token: string;
    };

    if (rawToken.endsWith('.ts')) {
      rawToken = rawToken.slice(0, -3);
    }

    return streamLiveMpegTs(outputId, rawToken, request, reply);
  });

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

    // Support /hls/:outputId/:token/live.ts as direct live TS stream
    if (safeFile === 'live.ts' || safeFile === 'stream.ts') {
      return streamLiveMpegTs(outputId, rawToken, request, reply);
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
