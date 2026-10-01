import type { StreamEvent } from '../types';
import { logServerError, safeAgentError } from './error';

/**
 * Streams newline-delimited JSON events. Work is cancelled when the client disconnects, and events
 * emitted after that are dropped instead of throwing on a closed stream.
 */
export function ndjsonResponse(
  request: Request,
  run: (emit: (event: StreamEvent) => void, signal: AbortSignal) => Promise<void>,
) {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const onClientAbort = () => abort.abort();
  request.signal.addEventListener('abort', onClientAbort, { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const emit = (event: StreamEvent) => {
        if (!open || abort.signal.aborted) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await run(emit, abort.signal);
      } catch (error) {
        logServerError(new URL(request.url).pathname, error);
        emit({ type: 'run.error', message: safeAgentError(error) });
      } finally {
        request.signal.removeEventListener('abort', onClientAbort);
        open = false;
        try {
          controller.close();
        } catch {
          // The stream was already cancelled by the client.
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
