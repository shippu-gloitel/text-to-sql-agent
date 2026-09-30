import type { QueryColumn, QueryResult } from '../types';

function serialize(row: Record<string, unknown>) {
  return JSON.stringify(row, (_, value) => (typeof value === 'bigint' ? value.toString() : value));
}

/** Keeps rows until either the row limit or the serialized response size limit is reached. */
export function boundRows(
  rows: Record<string, unknown>[],
  columns: QueryColumn[],
  maxRows: number,
  maxResponseBytes: number,
  durationMs: number,
): QueryResult {
  const kept: Record<string, unknown>[] = [];
  let responseBytes = 2;
  for (const row of rows) {
    const rowBytes = Buffer.byteLength(serialize(row));
    const separatorBytes = kept.length ? 1 : 0;
    if (kept.length >= maxRows || responseBytes + separatorBytes + rowBytes > maxResponseBytes)
      break;
    kept.push(row);
    responseBytes += separatorBytes + rowBytes;
  }
  return {
    columns,
    // BigInt values cannot be sent as JSON, so they are converted to strings.
    rows: kept.map(row => JSON.parse(serialize(row)) as Record<string, unknown>),
    rowCount: kept.length,
    truncated: kept.length < rows.length,
    durationMs,
  };
}
