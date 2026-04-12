import { type NextRequest, NextResponse } from 'next/server';

/**
 * Lightweight middleware that protects routes by checking for the session cookie.
 *
 * Full session validation (DB lookup) happens in Server Components via `auth()`.
 * We intentionally avoid importing the auth config here because the Edge Runtime
 * cannot use Node.js modules required by the database driver.
 */
export function middleware(req: NextRequest) {
  const sessionCookie =
    req.cookies.get('authjs.session-token') ?? req.cookies.get('__Secure-authjs.session-token');

  const pathname = req.nextUrl.pathname;
  const isProtected = pathname.startsWith('/dashboard') || pathname === '/';

  if (isProtected && !sessionCookie?.value) {
    const loginUrl = new URL('/login', req.nextUrl);
    loginUrl.searchParams.set('callbackUrl', req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api/health|api/stream|_next/static|_next/image|favicon.ico).*)'],
};
