import { runAgent } from '@/lib/server/agent';
import { ndjsonResponse } from '@/lib/server/stream';
import { runRequestSchema } from '@/lib/types';

export async function POST(request: Request) {
  const parsed = runRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ message: 'The request was invalid.' }, { status: 400 });

  return ndjsonResponse(request, (emit, signal) => runAgent(parsed.data, emit, signal));
}
