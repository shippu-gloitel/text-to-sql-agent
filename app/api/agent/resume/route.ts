import { resumeAgent } from '@/lib/server/agent';
import { ndjsonResponse } from '@/lib/server/stream';
import { resumeRequestSchema } from '@/lib/types';

export async function POST(request: Request) {
  const parsed = resumeRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const details = parsed.error.issues
      .map(issue => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join(' ');
    return Response.json(
      { message: `The approval request was invalid. ${details}` },
      { status: 400 },
    );
  }

  return ndjsonResponse(request, (emit, signal) => resumeAgent(parsed.data, emit, signal));
}
