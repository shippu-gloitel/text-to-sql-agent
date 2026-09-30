import { healthCheck } from '@/lib/server/db';
import { UserFacingError } from '@/lib/server/error';
import { connectionProfileSchema } from '@/lib/types';

export async function POST(request: Request) {
  try {
    const profile = connectionProfileSchema.parse(await request.json());
    return Response.json(await healthCheck(profile));
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message:
          error instanceof UserFacingError
            ? error.message
            : 'Could not connect to the database. Check the connection details and try again.',
      },
      { status: 400 },
    );
  }
}
