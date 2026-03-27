import { NextRequest, NextResponse } from 'next/server';
import {
  AUTH_COOKIE_MAX_AGE_SECONDS,
  AUTH_COOKIE_NAME,
  createAuthSessionValue,
  isSafeNextPath,
} from '@/lib/auth-session';

// ── In-memory rate limiter (brute-force protection) ───────────────────────────
// Allows MAX_ATTEMPTS failed attempts per IP within WINDOW_MS before locking out.
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 10;

interface RateEntry { count: number; windowStart: number }
const rateLimitMap = new Map<string, RateEntry>();

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 0, windowStart: now });
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
}

function clearAttempts(ip: string): void {
  rateLimitMap.delete(ip);
}

// Periodically clean up stale entries to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now - entry.windowStart > RATE_WINDOW_MS) rateLimitMap.delete(ip);
  }
}, RATE_WINDOW_MS);

function getSecretCode() {
  return process.env.ACCESS_CODE || process.env.MIS_ACCESS_CODE;
}

function buildAuthUrl(request: NextRequest, nextPath: string, error?: string) {
  const authUrl = new URL('/auth', request.url);
  if (error) {
    authUrl.searchParams.set('error', error);
  }
  if (nextPath !== '/') {
    authUrl.searchParams.set('next', nextPath);
  }
  return authUrl;
}

function resolveNextPath(request: NextRequest, rawPath: string | null) {
  if (isSafeNextPath(rawPath)) {
    return rawPath;
  }

  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      const next = refererUrl.searchParams.get('next');
      if (isSafeNextPath(next)) {
        return next;
      }
    } catch {
      // Ignore malformed referer headers and fall back to the root page.
    }
  }

  return '/';
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  // Rate limit check — return 429 before even reading the body
  if (isRateLimited(ip)) {
    return NextResponse.redirect(buildAuthUrl(request, '/', 'too-many-attempts'), { status: 303 });
  }

  const formData = await request.formData();
  const submittedCode = String(formData.get('code') || '').trim();
  const nextPath = resolveNextPath(request, String(formData.get('next') || ''));
  const secretCode = getSecretCode();

  if (!secretCode) {
    return NextResponse.json(
      { error: 'ACCESS_CODE or MIS_ACCESS_CODE is not configured on the server.' },
      { status: 500 }
    );
  }

  if (submittedCode !== secretCode) {
    recordFailedAttempt(ip);
    return NextResponse.redirect(buildAuthUrl(request, nextPath, 'invalid-code'), { status: 303 });
  }

  // Successful auth — clear failure count
  clearAttempts(ip);

  const sessionValue = await createAuthSessionValue();
  if (!sessionValue) {
    return NextResponse.json(
      { error: 'AUTH_SESSION_SECRET, ACCESS_CODE, or MIS_ACCESS_CODE is not configured on the server.' },
      { status: 500 }
    );
  }

  const response = NextResponse.redirect(new URL(nextPath, request.url), { status: 303 });
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: sessionValue,
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
  });

  return response;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const shouldLogout = url.searchParams.get('logout') === '1';
  const nextPath = resolveNextPath(request, url.searchParams.get('next'));

  if (!shouldLogout) {
    return NextResponse.redirect(buildAuthUrl(request, nextPath), { status: 303 });
  }

  const response = NextResponse.redirect(buildAuthUrl(request, nextPath), { status: 303 });
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: '',
    path: '/',
    expires: new Date(0),
  });

  return response;
}
