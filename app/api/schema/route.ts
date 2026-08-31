import { introspect } from '@/lib/server/db';
import { connectionProfileSchema } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const profile = connectionProfileSchema.parse(await request.json());
    return Response.json(await introspect(profile));
  } catch {
    return Response.json(
      { message: 'Schema inspection failed. Confirm the database user can read metadata.' },
      { status: 400 },
    );
  }
}
