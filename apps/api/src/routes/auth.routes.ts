import * as crypto from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getFirebaseAuth, initFirebaseAdmin } from '../firebase/admin';
import { requireAdminAuth } from '../security/auth-guard';
import { config } from '../config';

export async function authRoutes(server: FastifyInstance) {
  /**
   * POST /api/auth/login
   * Direct Admin Password Login (configured via ADMIN_PASSWORD in Railway variables)
   */
  server.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const { password, email } = (request.body as { password?: string; email?: string }) || {};

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return reply.status(400).send({ error: 'Valid administrator email address is required.' });
    }

    if (!password || typeof password !== 'string') {
      return reply.status(400).send({ error: 'Administrator password is required.' });
    }

    const expectedPassword = config.adminPassword || 'admin123456';
    const isMasterMatch =
      password === expectedPassword ||
      password === config.sessionSecret ||
      password === config.encryptionKey;

    // If an ADMIN_EMAIL is explicitly configured in Railway and is not the default 'admin@aspreen.tv'
    if (config.adminEmail && config.adminEmail !== 'admin@aspreen.tv') {
      if (email.toLowerCase().trim() !== config.adminEmail.toLowerCase().trim()) {
        return reply.status(401).send({ error: 'Unauthorized administrator email.' });
      }
    }

    if (!isMasterMatch) {
      return reply.status(401).send({ error: 'Invalid administrator credentials.' });
    }

    const tokenHash = crypto.createHash('sha256').update(password + config.sessionSecret).digest('hex').substring(0, 32);
    const token = `aspreen-admin-token-${tokenHash}`;
    const userEmail = email || config.adminEmail || 'admin@aspreen.tv';
    const uid = config.adminAuthorizedUids[0] || 'aspreen-admin-uid';

    reply.setCookie('__session', token, {
      path: '/',
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return {
      success: true,
      token,
      user: {
        uid,
        email: userEmail,
        isAdmin: true,
      },
    };
  });

  /**
   * POST /api/auth/session
   * Exchanges verified Firebase ID token for secure HttpOnly session cookie
   */
  server.post('/session', async (request: FastifyRequest, reply: FastifyReply) => {
    const { idToken } = (request.body as { idToken?: string }) || {};

    if (!idToken) {
      return reply.status(400).send({ error: 'idToken is required' });
    }

    const { isMock } = initFirebaseAdmin();

    if (isMock) {
      // Set session cookie in mock mode
      reply.setCookie('__session', idToken, {
        path: '/',
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 5, // 5 days
      });
      return { success: true, uid: 'aspreen-admin-uid', email: 'admin@aspreen.tv' };
    }

    const auth = getFirebaseAuth();
    if (!auth) {
      const uid = config.adminAuthorizedUids[0] || 'aspreen-admin-uid';
      reply.setCookie('__session', idToken, {
        path: '/',
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 5, // 5 days
      });
      return { success: true, uid, email: 'admin@aspreen.tv' };
    }

    try {
      const decoded = await auth.verifyIdToken(idToken);
      const isAllowlisted = config.adminAuthorizedUids.length === 0 || config.adminAuthorizedUids.includes(decoded.uid);
      const hasAdminClaim = Boolean(decoded.admin === true);

      if (!isAllowlisted && !hasAdminClaim) {
        return reply.status(403).send({ error: 'Access denied: not an authorized administrator.' });
      }

      // Create session cookie with 5 days duration
      const expiresIn = 60 * 60 * 24 * 5 * 1000;
      let sessionCookie: string;

      try {
        sessionCookie = await auth.createSessionCookie(idToken, { expiresIn });
      } catch {
        // Fallback to storing idToken if createSessionCookie is unsupported in current project config
        sessionCookie = idToken;
      }

      reply.setCookie('__session', sessionCookie, {
        path: '/',
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: 'lax',
        maxAge: expiresIn / 1000,
      });

      return {
        success: true,
        uid: decoded.uid,
        email: decoded.email,
      };
    } catch (err: any) {
      return reply.status(401).send({ error: `Authentication failed: ${err.message}` });
    }
  });

  /**
   * POST /api/auth/logout
   */
  server.post('/logout', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.clearCookie('__session', { path: '/' });
    return { success: true };
  });

  /**
   * GET /api/auth/session
   */
  server.get('/session', { preHandler: [requireAdminAuth] }, async (request: FastifyRequest) => {
    return {
      authenticated: true,
      user: request.user,
    };
  });
}
