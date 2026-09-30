import { testModel } from '@/lib/server/agent';
import { modelProfileSchema } from '@/lib/types';

export async function POST(request: Request) {
  try {
    const profile = modelProfileSchema.parse(await request.json());
    return Response.json(await testModel(profile));
  } catch {
    return Response.json(
      { ok: false, message: 'Could not reach the model. Check the provider, model, and API key.' },
      { status: 400 },
    );
  }
}
