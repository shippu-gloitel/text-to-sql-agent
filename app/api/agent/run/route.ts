import { runAgent } from '@/lib/server/agent';
import { safeAgentError } from '@/lib/server/error';
import { runRequestSchema } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const input = runRequestSchema.parse(await request.json());
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (event: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        try {
          await runAgent(input, emit);
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
    return Response.json({ message: 'The request was invalid.' }, { status: 400 });
  }
}
