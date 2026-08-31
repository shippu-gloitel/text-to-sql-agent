import { healthCheck } from '@/lib/server/db';
import { connectionProfileSchema } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const profile = connectionProfileSchema.parse(await request.json());
    return Response.json(await healthCheck(profile));
  } catch {
    return Response.json(
      {
        ok: false,
        message: 'Could not connect to the database. Check the connection details and try again.',
      },
      { status: 400 },
    );
  }
}
