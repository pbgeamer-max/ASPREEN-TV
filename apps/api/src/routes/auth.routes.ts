import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getFirebaseAuth, initFirebaseAdmin } from '../firebase/admin';
import { requireAdminAuth } from '../security/auth-guard';
import { config } from '../config';

export async function authRoutes(server: FastifyInstance) {
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
      return reply.status(500).send({ error: 'Firebase Auth is not initialized' });
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
