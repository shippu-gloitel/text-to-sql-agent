import { expect, spyOn, test } from 'bun:test';
import { ndjsonResponse } from './stream';

test('streamed failures use the active stage to explain the failing subsystem', async () => {
  const log = spyOn(console, 'error').mockImplementation(() => undefined);
  const response = ndjsonResponse(new Request('http://localhost/api/agent/run'), async emit => {
    emit({ type: 'stage.started', stage: 'Reading schema' });
    throw new Error('connect ECONNREFUSED');
  });

  const events = (await response.text())
    .trim()
    .split('\n')
    .map(line => JSON.parse(line) as { type: string; message?: string });

  expect(events.at(-1)).toEqual({
    type: 'run.error',
    message:
      'The database connection failed while reading its schema. Check the saved connection and the server network access.',
  });
  log.mockRestore();
});
