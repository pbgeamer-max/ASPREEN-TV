import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Public paths that do not require administrator dashboard authentication
const PUBLIC_PREFIXES = [
  '/login',
  '/api/auth',
  '/api/app',
  '/api/v1',
  '/live',
  '/hls',
  '/ts',
  '/playlist.m3u',
  '/channels.m3u',
  '/_next',
  '/favicon.ico',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Allow public media, static assets, and auth endpoints
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname.startsWith(prefix) || pathname === prefix) {
      return NextResponse.next();
    }
  }

  // Allow static files (images, icons, etc.)
  if (/\.(png|jpg|jpeg|gif|svg|ico|webp|mp4|m3u8|ts|css|js)$/i.test(pathname)) {
    return NextResponse.next();
  }

  // 2. Check for active session cookie or authorization header
  const sessionCookie = request.cookies.get('__session')?.value;
  const authHeader = request.headers.get('authorization');

  // If user is not authenticated, strictly redirect to /login
  if (!sessionCookie && !authHeader) {
    const loginUrl = new URL('/login', request.url);
    // Optionally preserve return path
    if (pathname !== '/') {
      loginUrl.searchParams.set('from', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
