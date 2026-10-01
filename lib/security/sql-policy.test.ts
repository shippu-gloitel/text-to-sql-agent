import { describe, expect, test } from 'bun:test';
import { enforceRowLimit, matchesAllowedObject, validateSql } from './sql-policy';

describe('read-only SQL policy', () => {
  test('accepts an allowlisted select', () => {
    const result = validateSql('SELECT id FROM public.users', 'postgresql', ['public.users']);
    expect(result.valid).toBe(true);
    expect(result.tables).toEqual(['public.users']);
  });

  test('accepts joins across allowlisted tables', () => {
    const result = validateSql(
      'SELECT u.id, o.total FROM public.users u JOIN public.orders o ON o.user_id = u.id',
      'postgresql',
      ['public.users', 'public.orders'],
    );
    expect(result.valid).toBe(true);
    expect(result.tables).toEqual(['public.users', 'public.orders']);
  });

  test('matches an unqualified table to a qualified allowlist entry', () => {
    expect(validateSql('SELECT id FROM users', 'postgresql', ['public.users']).valid).toBe(true);
  });

  test('does not treat a CTE name as a database table', () => {
    const result = validateSql(
      'WITH recent_users AS (SELECT id FROM public.users) SELECT id FROM recent_users',
      'postgresql',
      ['public.users'],
    );
    expect(result.valid).toBe(true);
    expect(result.tables).toEqual(['public.users']);
  });

  test('rejects mutations and multiple statements', () => {
    expect(validateSql('DELETE FROM public.users', 'postgresql').valid).toBe(false);
    expect(validateSql('SELECT 1; SELECT 2', 'postgresql').valid).toBe(false);
    expect(validateSql("SELECT * FROM users INTO OUTFILE '/tmp/users.csv'", 'mysql').valid).toBe(
      false,
    );
    expect(validateSql('SELECT id FROM users FOR UPDATE', 'postgresql').valid).toBe(false);
  });

  test('rejects unsafe functions and allowlist escapes', () => {
    expect(validateSql("SELECT pg_read_file('/etc/passwd')", 'postgresql').valid).toBe(false);
    expect(validateSql('SELECT id FROM private.users', 'postgresql', ['public.users']).valid).toBe(
      false,
    );
  });

  test.each([
    ['postgresql', 'SELECT pg_terminate_backend(123)'],
    ['postgresql', "SELECT pg_read_binary_file('/etc/passwd')"],
    ['postgresql', "SELECT set_config('statement_timeout', '0', false)"],
    ['postgresql', "SELECT current_setting('data_directory')"],
    ['postgresql', 'SELECT "pg_sleep"(10)'],
    ['postgresql', "SELECT id FROM users WHERE id IN (SELECT lo_import('/etc/passwd'))"],
    ['postgresql', "SELECT query_to_xml('select 1', true, true, '')"],
    ['mysql', 'SELECT SLEEP(100)'],
    ['mysql', 'SELECT BENCHMARK(100000000, MD5(1))'],
    ['mysql', "SELECT GET_LOCK('x', 10)"],
    ['mysql', 'SELECT id FROM users # hidden comment'],
    ['sqlite', "SELECT load_extension('evil')"],
  ] as const)('blocks %s: %s', (dialect, sql) => {
    expect(validateSql(sql, dialect).valid).toBe(false);
  });

  test.each([
    ['postgresql', 'SELECT * FROM users u WHERE u.user_id = :user_id LIMIT 5', ':user_id'],
    ['postgresql', 'SELECT * FROM users WHERE user_id = $1', '$1'],
    ['mysql', 'SELECT * FROM users WHERE user_id = ?', '?'],
    ['sqlite', 'SELECT * FROM users WHERE user_id = :uid', ':uid'],
  ] as const)('rejects placeholders: %s %s', (dialect, sql, placeholder) => {
    const result = validateSql(sql, dialect);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain(`placeholder ${placeholder}`);
  });

  test('allows PostgreSQL casts that look like placeholders', () => {
    expect(
      validateSql("SELECT created_at::date, '10:30'::time FROM users", 'postgresql').valid,
    ).toBe(true);
  });

  test('ignores blocked words inside string literals and quoted identifiers', () => {
    expect(
      validateSql("SELECT id FROM users WHERE status = 'DELETE'", 'postgresql', ['public.users'])
        .valid,
    ).toBe(true);
    expect(validateSql("SELECT id FROM users WHERE note = 'a--b; c'", 'postgresql').valid).toBe(
      true,
    );
    expect(validateSql('SELECT "update", "set" FROM users', 'postgresql').valid).toBe(true);
    expect(validateSql("SELECT data #>> '{a,b}' FROM events", 'postgresql').valid).toBe(true);
  });

  test('allows ordinary functions and aggregates', () => {
    const result = validateSql(
      "SELECT lower(name), COUNT(*), COALESCE(email, 'n/a') FROM users GROUP BY lower(name), email",
      'postgresql',
    );
    expect(result.valid).toBe(true);
  });
});

describe('allowlist matching', () => {
  test('matches qualified and unqualified names', () => {
    expect(matchesAllowedObject('public.users', ['public.users'])).toBe(true);
    expect(matchesAllowedObject('users', ['public.users'])).toBe(true);
    expect(matchesAllowedObject('public.users', ['users'])).toBe(true);
    expect(matchesAllowedObject('PUBLIC.Users', ['public.users'])).toBe(true);
  });

  test('rejects a different schema or table', () => {
    expect(matchesAllowedObject('private.users', ['public.users'])).toBe(false);
    expect(matchesAllowedObject('orders', ['public.users'])).toBe(false);
    expect(matchesAllowedObject('xusers', ['users'])).toBe(false);
  });
});

describe('row limit enforcement', () => {
  test('appends a limit when the outer query has none', () => {
    expect(enforceRowLimit('SELECT * FROM users', 'postgresql', 50)).toBe(
      'SELECT * FROM users\nLIMIT 50',
    );
  });

  test('keeps a smaller outer limit untouched', () => {
    expect(enforceRowLimit('SELECT * FROM users LIMIT 10', 'postgresql', 50)).toBe(
      'SELECT * FROM users LIMIT 10',
    );
    expect(enforceRowLimit('SELECT * FROM users LIMIT 5, 10', 'mysql', 50)).toBe(
      'SELECT * FROM users LIMIT 5, 10',
    );
  });

  test('bounds a larger outer limit by wrapping the query', () => {
    expect(enforceRowLimit('SELECT * FROM users LIMIT 100000', 'postgresql', 50)).toContain(
      ') AS bounded_result\nLIMIT 50',
    );
    expect(enforceRowLimit('SELECT * FROM users LIMIT 0, 100000', 'mysql', 50)).toContain(
      'LIMIT 50',
    );
  });

  test('does not treat a subquery limit as the outer bound', () => {
    expect(
      enforceRowLimit('SELECT * FROM (SELECT id FROM users LIMIT 5) t', 'postgresql', 50),
    ).toMatch(/\nLIMIT 50$/);
  });

  test('reads the limit of the last branch of a union', () => {
    expect(enforceRowLimit('SELECT 1 UNION ALL SELECT 2 LIMIT 3', 'postgresql', 50)).toBe(
      'SELECT 1 UNION ALL SELECT 2 LIMIT 3',
    );
    expect(enforceRowLimit('SELECT 1 UNION ALL SELECT 2', 'postgresql', 50)).toMatch(/\nLIMIT 50$/);
  });

  test('strips a trailing semicolon', () => {
    expect(enforceRowLimit('SELECT * FROM users;', 'sqlite', 5)).toBe(
      'SELECT * FROM users\nLIMIT 5',
    );
  });
});
