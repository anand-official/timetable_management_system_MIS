import { NextRequest, NextResponse } from 'next/server';

// ── Security headers ───────────────────────────────────────────────────────────
const SECURITY_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
  'X-DNS-Prefetch-Control': 'on',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const AUTH_COOKIE_NAME = 'mis-access';
const PUBLIC_PATH_PREFIXES = ['/auth', '/api/auth'];

function applySecurityHeaders(response: NextResponse) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
}

function isPublicPath(pathname: string) {
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isAuthEnabled() {
  return (process.env.AUTH_ENABLED ?? 'true').toLowerCase() !== 'false';
}

// ── Middleware ─────────────────────────────────────────────────────────────────

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!isAuthEnabled()) {
    const response = NextResponse.next();
    applySecurityHeaders(response);
    return response;
  }

  if (isPublicPath(pathname)) {
    const response = NextResponse.next();
    applySecurityHeaders(response);
    return response;
  }

  const hasValidSession = request.cookies.get(AUTH_COOKIE_NAME)?.value === 'granted';
  if (!hasValidSession) {
    if (pathname.startsWith('/api/')) {
      const unauthorizedResponse = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      applySecurityHeaders(unauthorizedResponse);
      return unauthorizedResponse;
    }

    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/auth';
    redirectUrl.search = '';

    if (pathname !== '/') {
      redirectUrl.searchParams.set('next', `${pathname}${search}`);
    }

    const redirectResponse = NextResponse.redirect(redirectUrl);
    applySecurityHeaders(redirectResponse);
    return redirectResponse;
  }

  const response = NextResponse.next();
  applySecurityHeaders(response);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
