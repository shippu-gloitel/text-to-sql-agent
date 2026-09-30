import { describe, expect, test } from 'bun:test';
import {
  extractPastedSql,
  isGreeting,
  isRowCountQuestion,
  isTableListQuestion,
  restrictSchema,
  rowCountResult,
} from './utils';

describe('extractPastedSql', () => {
  test('detects plain and fenced SQL', () => {
    expect(extractPastedSql('SELECT id FROM users')).toBe('SELECT id FROM users');
    expect(extractPastedSql('```sql\nSELECT id FROM users\n```')).toBe('SELECT id FROM users');
  });

  test('strips comments but keeps comment-like text inside literals', () => {
    expect(extractPastedSql("SELECT '--keep' AS a -- drop\nFROM t")).toBe(
      "SELECT '--keep' AS a \nFROM t",
    );
    expect(extractPastedSql('/* note */ SELECT 1')).toBe('SELECT 1');
  });

  test('ignores natural-language questions', () => {
    expect(extractPastedSql('Show me the newest users')).toBeUndefined();
  });
});

describe('question routing', () => {
  test('recognises greetings', () => {
    expect(isGreeting('hello there!')).toBe(true);
    expect(isGreeting('hello, list users')).toBe(false);
  });

  test('recognises table listing questions', () => {
    expect(isTableListQuestion('Which tables are available?')).toBe(true);
    expect(isTableListQuestion('How many rows are in each table?')).toBe(false);
  });
});

describe('row count questions', () => {
  test.each([
    'How many rows are in each table?',
    'How many rows are in each table',
    'row count for every table',
    'number of records in all tables',
    'Count the rows per table',
  ])('answers "%s" from statistics', question => {
    expect(isRowCountQuestion(question)).toBe(true);
  });

  test.each([
    'How many rows are in the users table?',
    'Show the five newest users',
    'list all tables',
  ])('leaves "%s" to the model', question => {
    expect(isRowCountQuestion(question)).toBe(false);
  });

  test('labels estimates and respects the allowlist', () => {
    const counts = [
      { schema: 'public', table: 'users', rows: 5000 },
      { schema: 'private', table: 'secrets', rows: 3 },
    ];
    const result = rowCountResult(counts, ['public.users'], true, 100, 100_000);
    expect(result.columns.map(column => column.name)).toEqual([
      'schema',
      'table',
      'estimated_rows',
    ]);
    expect(result.rows).toEqual([{ schema: 'public', table: 'users', estimated_rows: 5000 }]);
  });
});

describe('restrictSchema', () => {
  test('keeps only allowlisted tables and their relationships', () => {
    const schema = {
      fingerprint: 'x',
      tables: [
        { schema: 'public', name: 'users', columns: [] },
        { schema: 'public', name: 'orders', columns: [] },
        { schema: 'private', name: 'secrets', columns: [] },
      ],
      relationships: [
        {
          fromSchema: 'public',
          fromTable: 'orders',
          fromColumn: 'user_id',
          toSchema: 'public',
          toTable: 'users',
          toColumn: 'id',
        },
        {
          fromSchema: 'private',
          fromTable: 'secrets',
          fromColumn: 'user_id',
          toSchema: 'public',
          toTable: 'users',
          toColumn: 'id',
        },
      ],
    };
    const restricted = restrictSchema(schema, ['public.users', 'orders']);
    expect(restricted.tables.map(table => table.name)).toEqual(['users', 'orders']);
    expect(restricted.relationships).toHaveLength(1);
  });
});
