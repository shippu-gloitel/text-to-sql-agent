import { Parser } from 'node-sql-parser';
import type { Dialect } from '../types';

const parser = new Parser();
const dangerousWords =
  /\b(INSERT|UPDATE|DELETE|MERGE|UPSERT|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|CALL|DO|COPY|PRAGMA|VACUUM|ANALYZE|ATTACH|DETACH|LOAD|SET|BEGIN|COMMIT|ROLLBACK)\b/i;
const dangerousFunctions =
  /\b(pg_sleep|pg_read_file|pg_ls_dir|dblink|nextval|setval|lo_import|lo_export|load_extension|load_file|outfile|dumpfile)\s*\(/i;

const parserDialect: Record<Dialect, string> = {
  postgresql: 'Postgresql',
  mysql: 'MySQL',
  sqlite: 'Sqlite',
};

export type SqlValidation = {
  valid: boolean;
  sql: string;
  tables: string[];
  checks: string[];
  errors: string[];
};

export function validateSql(
  sql: string,
  dialect: Dialect,
  allowedObjects: string[] = [],
): SqlValidation {
  const normalized = sql.trim().replace(/;\s*$/, '');
  const errors: string[] = [];
  const checks = ['Single statement', 'Read-only statement', 'No unsafe system operations'];

  if (!normalized) errors.push('SQL is empty.');
  if (normalized.includes(';')) errors.push('Multiple statements are not allowed.');
  if (/--|\/\*/.test(normalized)) errors.push('SQL comments are not allowed in generated queries.');
  if (!/^\s*(SELECT|WITH)\b/i.test(normalized))
    errors.push('Only SELECT and read-only WITH queries are allowed.');
  if (dangerousWords.test(normalized))
    errors.push('The query contains a blocked statement or command.');
  if (dangerousFunctions.test(normalized)) errors.push('The query contains a blocked function.');

  let parsed:
    | {
        tableList?: string[];
        ast?: {
          type?: string;
          into?: { position?: unknown };
          with?: Array<{ name?: { value?: string } | string }>;
        };
      }
    | undefined;
  if (!errors.length) {
    try {
      parsed = parser.parse(normalized, { database: parserDialect[dialect] }) as typeof parsed;
      const ast = parsed?.ast;
      if (ast?.type !== 'select')
        errors.push('The query could not be verified as a SELECT statement.');
      if (ast?.into?.position) errors.push('SELECT INTO is not allowed.');
    } catch {
      errors.push('The SQL could not be parsed for this database dialect.');
    }
  }

  const cteNames = new Set(
    (parsed?.ast?.with ?? [])
      .map(cte => (typeof cte.name === 'string' ? cte.name : cte.name?.value))
      .filter((name): name is string => Boolean(name))
      .map(name => name.toLowerCase()),
  );
  const tables = (parsed?.tableList ?? [])
    .map(entry =>
      entry
        .replace(/^select::/, '')
        .replaceAll('::', '.')
        .replace(/^null\./i, ''),
    )
    .filter(entry => entry && entry !== '(.*)' && !cteNames.has(entry.toLowerCase()));
  if (
    allowedObjects.length &&
    tables.some(
      table =>
        !allowedObjects.some(allowed => {
          const actual = table.toLowerCase();
          const configured = allowed.toLowerCase();
          return (
            actual === configured ||
            actual.endsWith(`.${configured}`) ||
            configured.endsWith(`.${actual}`)
          );
        }),
    )
  ) {
    errors.push('The query references a table outside the configured allowlist.');
  }

  return { valid: errors.length === 0, sql: normalized, tables, checks, errors };
}

export function addSafetyLimit(sql: string, maxRows: number) {
  if (/\bLIMIT\s+\d+/i.test(sql)) return sql;
  return `${sql.replace(/;\s*$/, '')}\nLIMIT ${maxRows}`;
}
