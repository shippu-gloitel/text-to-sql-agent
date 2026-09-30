import { describe, expect, test } from 'bun:test';
import { boundRows } from './result';

const columns = [{ name: 'id' }];

describe('boundRows', () => {
  test('keeps every row under the limits', () => {
    const result = boundRows([{ id: 1 }, { id: 2 }], columns, 10, 10_000, 5);
    expect(result).toEqual({
      columns,
      rows: [{ id: 1 }, { id: 2 }],
      rowCount: 2,
      truncated: false,
      durationMs: 5,
    });
  });

  test('truncates at the row limit', () => {
    const result = boundRows([{ id: 1 }, { id: 2 }, { id: 3 }], columns, 2, 10_000, 0);
    expect(result.rowCount).toBe(2);
    expect(result.truncated).toBe(true);
  });

  test('truncates at the response size limit', () => {
    const rows = Array.from({ length: 100 }, (_, id) => ({ id, text: 'x'.repeat(100) }));
    const result = boundRows(rows, columns, 1000, 1_000, 0);
    expect(result.rowCount).toBeLessThan(10);
    expect(JSON.stringify(result.rows).length).toBeLessThanOrEqual(1_000);
    expect(result.truncated).toBe(true);
  });

  test('converts BigInt values to strings so rows can be sent as JSON', () => {
    const result = boundRows([{ id: 9007199254740993n }], columns, 10, 10_000, 0);
    expect(result.rows).toEqual([{ id: '9007199254740993' }]);
  });
});
