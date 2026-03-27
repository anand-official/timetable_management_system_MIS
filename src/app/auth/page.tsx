import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { GraduationCap, Lock, ArrowRight } from 'lucide-react';
import {
  AUTH_COOKIE_NAME,
  isSafeNextPath,
  verifyAuthSessionValue,
} from '@/lib/auth-session';

type AuthPageSearchParams = Promise<{
  next?: string | string[];
  error?: string | string[];
}>;

function readSearchParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function isAuthEnabled() {
  return (process.env.AUTH_ENABLED ?? 'true').toLowerCase() !== 'false';
}

export default async function AuthPage({
  searchParams,
}: {
  searchParams?: AuthPageSearchParams;
}) {
  if (!isAuthEnabled()) {
    redirect('/');
  }

  const cookieStore = await cookies();
  const resolvedSearchParams = (await searchParams) ?? {};
  const nextCandidate = readSearchParam(resolvedSearchParams.next);
  const errorCode = readSearchParam(resolvedSearchParams.error);
  const isAuthenticated = await verifyAuthSessionValue(cookieStore.get(AUTH_COOKIE_NAME)?.value);
  const nextPath = isSafeNextPath(nextCandidate) ? nextCandidate : '/';

  if (isAuthenticated) {
    redirect(nextPath);
  }

  return (
    <main className="relative min-h-screen bg-mesh-purple flex items-center justify-center px-4 overflow-hidden">
      {/* Dot grid overlay */}
      <div className="absolute inset-0 bg-dot-grid opacity-40 pointer-events-none" />

      {/* Decorative blobs */}
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-indigo-400/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-violet-400/10 blur-3xl pointer-events-none" />

      {/* Card */}
      <div className="relative w-full max-w-md animate-scale-in">
        {/* Logo + School name */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-4">
            <div
              className="h-20 w-20 rounded-2xl flex items-center justify-center shadow-xl overflow-hidden"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
            >
              <img
                src="/logo.png"
                alt="Modern Indian School"
                className="h-full w-full object-contain p-2"
              />
            </div>
            {/* Glow ring */}
            <div className="absolute inset-0 rounded-2xl ring-4 ring-indigo-200/60 scale-110 pointer-events-none" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 text-center leading-tight">
            Modern Indian School
          </h1>
          <p className="text-sm text-slate-500 mt-1 font-medium tracking-wide">
            Timetable Management System · 2025–26
          </p>
        </div>

        {/* Auth card */}
        <div className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl shadow-indigo-200/30 border border-white/80 overflow-hidden">
          {/* Card header stripe */}
          <div
            className="h-1.5 w-full"
            style={{ background: 'linear-gradient(90deg, #6366f1, #8b5cf6, #a78bfa)' }}
          />

          <div className="px-8 pt-7 pb-8">
            <div className="mb-6">
              <h2 className="text-lg font-bold text-slate-900">Welcome back</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Enter your access code to continue
              </p>
            </div>

            <form method="POST" action="/api/auth" className="space-y-5">
              <input type="hidden" name="next" value={nextPath} />

              {(errorCode === 'invalid-code' || errorCode === 'too-many-attempts') && (
                <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 animate-fade-in">
                  <div className="h-4 w-4 rounded-full bg-red-500 flex items-center justify-center shrink-0 mt-0.5">
                    <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <p className="text-sm text-red-700 font-medium">
                    {errorCode === 'too-many-attempts'
                      ? 'Too many failed attempts. Please wait 15 minutes before trying again.'
                      : 'Incorrect access code. Please try again.'}
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="code" className="text-sm font-semibold text-slate-700">
                  Access Code
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none">
                    <Lock className="h-4 w-4 text-slate-400" />
                  </div>
                  <input
                    id="code"
                    name="code"
                    type="password"
                    autoComplete="one-time-code"
                    required
                    placeholder="Enter secret code"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400 text-sm font-medium transition-all duration-150 focus:outline-none focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-200"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-white font-semibold text-sm transition-all duration-200 btn-glow"
                style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
              >
                Unlock Access
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>

            <p className="mt-5 text-center text-xs text-slate-400">
              Different device?{' '}
              <Link
                href="/api/auth?logout=1"
                className="text-indigo-500 hover:text-indigo-700 font-medium underline underline-offset-2 transition-colors"
              >
                Clear stored access
              </Link>
            </p>
          </div>
        </div>

        {/* Footer note */}
        <p className="mt-6 text-center text-xs text-slate-400">
          Secured · MIS Admin Portal
        </p>
      </div>
    </main>
  );
}
