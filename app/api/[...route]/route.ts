import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type ApiNotFoundPayload = {
  status: number;
  error: 'API_ROUTE_NOT_FOUND';
  message: string;
  method: string;
  requestedPath: string;
  timestamp: string;
};

function createApiNotFoundResponse(request: NextRequest) {
  const payload: ApiNotFoundPayload = {
    status: 404,
    error: 'API_ROUTE_NOT_FOUND',
    message: 'The requested API route does not exist.',
    method: request.method,
    requestedPath: request.nextUrl.pathname,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(payload, {
    status: 404,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    },
  });
}

export function GET(request: NextRequest) {
  return createApiNotFoundResponse(request);
}

export function POST(request: NextRequest) {
  return createApiNotFoundResponse(request);
}

export function PUT(request: NextRequest) {
  return createApiNotFoundResponse(request);
}

export function PATCH(request: NextRequest) {
  return createApiNotFoundResponse(request);
}

export function DELETE(request: NextRequest) {
  return createApiNotFoundResponse(request);
}

export function OPTIONS(request: NextRequest) {
  return createApiNotFoundResponse(request);
}

export function HEAD(request: NextRequest) {
  const response = createApiNotFoundResponse(request);
  return new NextResponse(null, { status: response.status, headers: response.headers });
}
