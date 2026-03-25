import { NextRequest, NextResponse } from 'next/server';

const AUTH_COOKIE_NAME = 'mis-access';
const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours

function getSecretCode() {
  return process.env.ACCESS_CODE || process.env.MIS_ACCESS_CODE;
}

function resolveNextPath(request: NextRequest, rawPath: string | null) {
  if (rawPath && rawPath.startsWith('/')) {
    return rawPath;
  }

  const referer = request.headers.get('referer');
  if (referer) {
    const refererUrl = new URL(referer);
    const next = refererUrl.searchParams.get('next');
    if (next && next.startsWith('/')) {
      return next;
    }
  }

  return '/';
}

export async function POST(request: NextRequest) {
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
    return NextResponse.redirect(new URL('/auth?error=invalid-code', request.url), { status: 303 });
  }

  const response = NextResponse.redirect(new URL(nextPath, request.url), { status: 303 });
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: 'granted',
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
  });

  return response;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const shouldLogout = url.searchParams.get('logout') === '1';

  if (!shouldLogout) {
    return NextResponse.redirect(new URL('/auth', request.url), { status: 303 });
  }

  const response = NextResponse.redirect(new URL('/auth', request.url), { status: 303 });
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: '',
    path: '/',
    expires: new Date(0),
  });

  return response;
}
