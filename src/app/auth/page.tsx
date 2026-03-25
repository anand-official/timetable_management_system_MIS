import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

const AUTH_COOKIE_NAME = 'mis-access';

export default async function AuthPage({
  searchParams,
}: {
  searchParams?: { next?: string };
}) {
  const cookieStore = await cookies();
  const isAuthenticated = cookieStore.get(AUTH_COOKIE_NAME)?.value === 'granted';
  const nextPath = searchParams?.next && searchParams.next.startsWith('/') ? searchParams.next : '/';

  if (isAuthenticated) {
    redirect(nextPath);
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Enter secret access code</CardTitle>
          <CardDescription>
            This timetable system is protected. Enter the shared code to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form method="POST" action="/api/auth" className="space-y-4">
            <input type="hidden" name="next" value={nextPath} />
            <div className="space-y-2">
              <Label htmlFor="code">Secret code</Label>
              <Input id="code" name="code" type="password" autoComplete="one-time-code" required />
            </div>
            <Button type="submit" className="w-full">Unlock</Button>
          </form>
          <p className="mt-4 text-sm text-muted-foreground">
            Need a fresh start? <Link href="/api/auth?logout=1" className="underline">Clear this device access</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
