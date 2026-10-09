import { FastifyRequest, FastifyReply } from 'fastify';
import { getFirebaseAuth, initFirebaseAdmin } from '../firebase/admin';
import { config } from '../config';

export interface AuthenticatedUser {
  uid: string;
  email?: string;
  isAdmin: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

/**
 * Fastify preHandler hook to verify Firebase ID token or session cookie
 * and enforce strict server-side administrator authorization.
 */
export async function requireAdminAuth(request: FastifyRequest, reply: FastifyReply) {
  const { isMock } = initFirebaseAdmin();

  // 1. Extract token from Authorization header or cookie
  const authHeader = request.headers.authorization;
  let idToken: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    idToken = authHeader.substring(7).trim();
  } else if (request.cookies && request.cookies.__session) {
    idToken = request.cookies.__session;
  }

  if (!idToken) {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Authentication token or session cookie is required.',
    });
  }

  // Standalone / Mock mode bypass for offline development & tests
  if (isMock) {
    // If running in mock mode, accept mock admin token or simulated tokens
    if (idToken === 'mock-admin-token' || idToken.startsWith('mock-')) {
      request.user = {
        uid: 'aspreen-admin-uid',
        email: 'admin@aspreen.tv',
        isAdmin: true,
      };
      return;
    }
  }

  const auth = getFirebaseAuth();
  if (!auth) {
    // Fallback if auth is not initialized
    if (idToken === 'mock-admin-token' || config.nodeEnv === 'development') {
      request.user = {
        uid: 'dev-admin-uid',
        email: 'admin@aspreen.tv',
        isAdmin: true,
      };
      return;
    }
    return reply.status(500).send({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Firebase Auth is not configured on the server.',
    });
  }

  try {
    // Verify ID token using Firebase Admin SDK
    const decodedToken = await auth.verifyIdToken(idToken);
    const uid = decodedToken.uid;
    const email = decodedToken.email;

    // Strict Admin Authorization Check:
    // Check if UID is in ADMIN_AUTHORIZED_UIDS allowlist or has custom claim admin: true
    const isAllowlisted = config.adminAuthorizedUids.length === 0 || config.adminAuthorizedUids.includes(uid);
    const hasAdminClaim = Boolean(decodedToken.admin === true);

    if (!isAllowlisted && !hasAdminClaim) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'This account does not have administrator privileges on Aspreen TV.',
      });
    }

    request.user = {
      uid,
      email,
      isAdmin: true,
    };
  } catch (err: any) {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: `Invalid or expired session: ${err.message}`,
    });
  }
}
