import { resumeAgent } from '@/lib/server/agent';
import { ndjsonResponse } from '@/lib/server/stream';
import { resumeRequestSchema } from '@/lib/types';

export async function POST(request: Request) {
  const parsed = resumeRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ message: 'The approval request was invalid.' }, { status: 400 });

  const { threadId, runId, decision, sql } = parsed.data;
  return ndjsonResponse(request, (emit, signal) =>
    resumeAgent(threadId, runId, { decision, sql }, emit, signal),
  );
}
