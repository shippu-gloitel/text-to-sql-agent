import { introspect } from '@/lib/server/db';
import { UserFacingError } from '@/lib/server/error';
import { connectionProfileSchema } from '@/lib/types';

export async function POST(request: Request) {
  try {
    const profile = connectionProfileSchema.parse(await request.json());
    return Response.json(await introspect(profile, { fresh: true }));
  } catch (error) {
    return Response.json(
      {
        message:
          error instanceof UserFacingError
            ? error.message
            : 'Schema inspection failed. Confirm the database user can read metadata.',
      },
      { status: 400 },
    );
  }
}
