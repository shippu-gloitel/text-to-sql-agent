import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

// Optional access control for shared deployments. Set APP_BASIC_AUTH="user:password" to require
// HTTP Basic authentication for the app and every API route. Unset, the app stays open, which
// is only appropriate on localhost or a trusted network.
function credentialsMatch(header: string | null, expected: string) {
  if (!header?.startsWith('Basic ')) return false;
  let provided: string;
  try {
    provided = atob(header.slice('Basic '.length));
  } catch {
    return false;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function proxy(request: NextRequest) {
  const expected = process.env.APP_BASIC_AUTH;
  if (!expected || credentialsMatch(request.headers.get('authorization'), expected))
    return NextResponse.next();

  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Queryroom", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
