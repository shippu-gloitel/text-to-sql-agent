import { describe, expect, test } from 'bun:test';
import { addSafetyLimit, validateSql } from './sql-policy';

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
  });

  test('rejects unsafe functions and allowlist escapes', () => {
    expect(validateSql("SELECT pg_read_file('/etc/passwd')", 'postgresql').valid).toBe(false);
    expect(validateSql('SELECT id FROM private.users', 'postgresql', ['public.users']).valid).toBe(
      false,
    );
  });

  test('adds a bounded result limit only when missing', () => {
    expect(addSafetyLimit('SELECT * FROM users', 50)).toContain('LIMIT 50');
    expect(addSafetyLimit('SELECT * FROM users LIMIT 10', 50)).toBe('SELECT * FROM users LIMIT 10');
  });
});
