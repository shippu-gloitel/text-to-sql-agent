import { testModel } from '@/lib/server/agent';
import { logServerError } from '@/lib/server/error';
import { modelProfileSchema } from '@/lib/types';

export async function POST(request: Request) {
  try {
    const profile = modelProfileSchema.parse(await request.json());
    return Response.json(await testModel(profile));
  } catch (error) {
    logServerError('/api/health/model', error);
    return Response.json(
      { ok: false, message: 'Could not reach the model. Check the provider, model, and API key.' },
      { status: 400 },
    );
  }
}
