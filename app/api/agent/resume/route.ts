import { resumeAgent } from '@/lib/server/agent';
import { safeAgentError } from '@/lib/server/error';
import { resumeRequestSchema } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const input = resumeRequestSchema.parse(await request.json());
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (event: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        try {
          await resumeAgent(input.threadId, { decision: input.decision, sql: input.sql }, emit);
        } catch (error) {
          emit({
            type: 'run.error',
            message: safeAgentError(error),
          });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return Response.json({ message: 'The approval request was invalid.' }, { status: 400 });
  }
}
