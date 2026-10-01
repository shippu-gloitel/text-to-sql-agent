import { describe, expect, test } from 'bun:test';
import {
  extractPastedSql,
  isGreeting,
  isRowCountQuestion,
  isTableListQuestion,
  inferRelationships,
  relationshipText,
  restrictSchema,
  rowCountResult,
  tableHint,
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

  test('drops the schema column when no table has a schema', () => {
    const result = rowCountResult(
      [{ schema: null, table: 'users', rows: 3 }],
      [],
      false,
      100,
      100_000,
    );
    expect(result.columns.map(column => column.name)).toEqual(['table', 'rows']);
    expect(result.rows).toEqual([{ table: 'users', rows: 3 }]);
  });
});

describe('relationships', () => {
  const columns = (...names: string[]) => names.map(name => ({ name, type: 'integer' }));
  const legacy = {
    fingerprint: 'x',
    relationships: [],
    tables: [
      {
        schema: 'public',
        name: 'users',
        columns: columns('user_id', 'role_id', 'administrative_sex_id', 'email'),
      },
      { schema: 'public', name: 'mas_role', columns: columns('role_id', 'role_name') },
      {
        schema: 'public',
        name: 'mas_administrative_sex',
        columns: columns('administrative_sex_id', 'name'),
      },
      { schema: 'public', name: 'user_mmu', columns: columns('user_mmu_id', 'user_id', 'mmu_id') },
      { schema: 'public', name: 'mas_mmu', columns: columns('mmu_id', 'mmu_name') },
      { schema: 'public', name: 'sessions', columns: columns('id', 'user_id') },
      { schema: 'public', name: 'audit_log', columns: columns('id', 'external_ref_id') },
    ],
  };

  test('infers joins from naming conventions when there are no foreign keys', () => {
    const joins = inferRelationships(legacy).map(
      r => `${r.fromTable}.${r.fromColumn}->${r.toTable}.${r.toColumn}`,
    );
    expect(joins).toEqual([
      'users.role_id->mas_role.role_id',
      'users.administrative_sex_id->mas_administrative_sex.administrative_sex_id',
      'user_mmu.user_id->users.user_id',
      'user_mmu.mmu_id->mas_mmu.mmu_id',
      'sessions.user_id->users.user_id',
    ]);
  });

  test('does not repeat columns that already have a foreign key', () => {
    const withForeignKey = {
      ...legacy,
      relationships: [
        {
          fromSchema: 'public',
          fromTable: 'sessions',
          fromColumn: 'user_id',
          toSchema: 'public',
          toTable: 'users',
          toColumn: 'user_id',
        },
      ],
    };
    const text = relationshipText(withForeignKey);
    expect(text).toContain(
      'Foreign keys (enforced by the database):\npublic.sessions.user_id -> public.users.user_id',
    );
    expect(text).toContain('Likely relationships inferred from column names');
    expect(text.match(/public\.sessions\.user_id/g)).toHaveLength(1);
  });

  test('explains when nothing can be inferred', () => {
    const schema = {
      fingerprint: 'x',
      relationships: [],
      tables: [{ name: 'notes', columns: columns('id', 'body') }],
    };
    expect(relationshipText(schema)).toContain('No relationships were discovered or inferred');
  });
});

describe('tableHint', () => {
  test('lists every table when there are few', () => {
    const schema = {
      fingerprint: 'x',
      relationships: [],
      tables: [
        { name: 'a', columns: [] },
        { name: 'b', columns: [] },
      ],
    };
    expect(tableHint(schema)).toBe('Available tables (2):\n• a\n• b');
  });

  test('lists every table even when there are many', () => {
    const tables = Array.from({ length: 250 }, (_, index) => ({
      schema: 'public',
      name: `t${index}`,
      columns: [],
    }));
    const hint = tableHint({ fingerprint: 'x', relationships: [], tables });
    expect(hint.split('\n')).toHaveLength(251);
    expect(hint).toContain('Available tables (250):');
    expect(hint).toContain('• public.t249');
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
