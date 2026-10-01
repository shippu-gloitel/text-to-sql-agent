import { Parser } from 'node-sql-parser';
import type { Dialect } from '../types';

const parser = new Parser();
const dangerousWords =
  /\b(INSERT|UPDATE|DELETE|MERGE|UPSERT|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|CALL|DO|COPY|PRAGMA|VACUUM|ANALYZE|ATTACH|DETACH|LOAD|SET|BEGIN|COMMIT|ROLLBACK|LOCK|HANDLER|INTO|EXEC|EXECUTE|PREPARE|DEALLOCATE|LISTEN|NOTIFY|REINDEX|CLUSTER|REFRESH)\b/i;

// Functions that read server files, sleep, take locks, change settings, touch sequences or
// reach other servers. Matched against every function call found in the parsed query.
const dangerousFunctionNames =
  /^(pg_.*|lo_.*|dblink.*|set_config|current_setting|nextval|setval|currval|lastval|txid_.*|query_to_xml.*|table_to_xml.*|schema_to_xml.*|database_to_xml.*|cursor_to_xml.*|sleep|benchmark|get_lock|release_lock|release_all_locks|is_free_lock|is_used_lock|load_file|load_extension|sys_.*|xp_.*|readfile|writefile|edit|fts3_tokenizer)$/i;
const dangerousFunctionCall =
  /\b(pg_\w+|lo_\w+|dblink\w*|set_config|current_setting|nextval|setval|sleep|benchmark|get_lock|load_file|load_extension|outfile|dumpfile|readfile|writefile)\s*\(/i;

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

type AstNode = Record<string, unknown>;
type SelectAst = AstNode & {
  type?: string;
  into?: { position?: unknown };
  with?: Array<{ name?: { value?: string } | string }>;
  limit?: { seperator?: string; value?: Array<{ type?: string; value?: unknown }> };
  _next?: SelectAst;
};

/**
 * Splits SQL into executable code and literals. String literals are blanked, quoted identifiers are
 * unwrapped for function checks (so `"pg_sleep"(1)` is still caught) and blanked for keyword checks
 * (so a column named "delete" is allowed), and comments are reported instead of copied.
 */
function maskSql(sql: string, dialect?: Dialect) {
  let keywordText = '';
  let functionText = '';
  let hasComment = false;
  let index = 0;
  while (index < sql.length) {
    const current = sql[index];
    const next = sql[index + 1];
    if (current === "'" || current === '"' || current === '`') {
      let end = index + 1;
      while (end < sql.length) {
        if (sql[end] === current) {
          if (sql[end + 1] === current) {
            end += 2;
            continue;
          }
          break;
        }
        end += 1;
      }
      const body = sql.slice(index + 1, end);
      if (current === "'") {
        keywordText += "''";
        functionText += "''";
      } else {
        keywordText += 'quoted_identifier';
        functionText += body;
      }
      index = end + 1;
      continue;
    }
    if (
      (current === '-' && next === '-') ||
      (current === '/' && next === '*') ||
      (current === '#' && dialect === 'mysql')
    ) {
      hasComment = true;
      break;
    }
    keywordText += current;
    functionText += current;
    index += 1;
  }
  return { keywordText, functionText, hasComment };
}

function collectFunctionNames(node: unknown, names: string[] = []) {
  if (!node || typeof node !== 'object') return names;
  if (Array.isArray(node)) {
    node.forEach(item => collectFunctionNames(item, names));
    return names;
  }
  const record = node as AstNode;
  if (record.type === 'function' || record.type === 'aggr_func') {
    const name = record.name as unknown;
    if (typeof name === 'string') names.push(name);
    else if (name && typeof name === 'object') {
      const parts = (name as { name?: Array<{ value?: unknown }> }).name ?? [];
      parts.forEach(part => typeof part.value === 'string' && names.push(part.value));
    }
  }
  Object.values(record).forEach(value => collectFunctionNames(value, names));
  return names;
}

/** Finds bind parameters (:name, $1, @var, ?), which cannot run because no values are bound. */
function findPlaceholder(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findPlaceholder(item);
      if (found) return found;
    }
    return undefined;
  }
  const record = node as AstNode;
  if (record.type === 'param') return `:${String(record.value)}`;
  if (record.type === 'var') return `${String(record.prefix ?? '')}${String(record.name)}`;
  if (record.type === 'origin' && record.value === '?') return '?';
  for (const value of Object.values(record)) {
    const found = findPlaceholder(value);
    if (found) return found;
  }
  return undefined;
}

/** Checks that need the parsed query: statement type, functions and placeholders. */
function checkParsedQuery(ast: SelectAst | undefined) {
  const errors: string[] = [];
  if (ast?.type !== 'select') errors.push('The query could not be verified as a SELECT statement.');
  if (ast?.into?.position) errors.push('SELECT INTO is not allowed.');
  const blocked = collectFunctionNames(ast).find(name => dangerousFunctionNames.test(name));
  if (blocked) errors.push(`The function ${blocked}() is not allowed.`);
  const placeholder = findPlaceholder(ast);
  if (placeholder)
    errors.push(
      `The placeholder ${placeholder} has no value. Write the actual value in the SQL instead.`,
    );
  return errors;
}

/** Allowlist entries match exactly, or by table name when one side is unqualified. */
export function matchesAllowedObject(table: string, allowedObjects: string[]) {
  const actual = table.toLowerCase();
  return allowedObjects.some(allowed => {
    const configured = allowed.toLowerCase();
    if (actual === configured) return true;
    if (!actual.includes('.')) return configured.endsWith(`.${actual}`);
    if (!configured.includes('.')) return actual.endsWith(`.${configured}`);
    return false;
  });
}

function parseSelect(sql: string, dialect: Dialect) {
  const parsed = parser.parse(sql, { database: parserDialect[dialect] }) as unknown as {
    tableList?: string[];
    ast?: SelectAst | SelectAst[];
  };
  const ast = Array.isArray(parsed.ast) ? parsed.ast[0] : parsed.ast;
  return { tableList: parsed.tableList ?? [], ast };
}

export function validateSql(
  sql: string,
  dialect: Dialect,
  allowedObjects: string[] = [],
): SqlValidation {
  const normalized = sql.trim().replace(/;\s*$/, '');
  const errors: string[] = [];
  const checks = [
    'Single statement',
    'Read-only statement',
    'No unsafe functions or system operations',
    'Tables limited to the verified schema',
  ];
  const masked = maskSql(normalized, dialect);

  if (!normalized) errors.push('SQL is empty.');
  if (masked.keywordText.includes(';')) errors.push('Multiple statements are not allowed.');
  if (masked.hasComment) errors.push('SQL comments are not allowed in generated queries.');
  if (!/^\s*(SELECT|WITH)\b/i.test(normalized))
    errors.push('Only SELECT and read-only WITH queries are allowed.');
  if (dangerousWords.test(masked.keywordText))
    errors.push('The query contains a blocked statement or command.');
  if (dangerousFunctionCall.test(masked.functionText))
    errors.push('The query contains a blocked function.');

  let tableList: string[] = [];
  let ast: SelectAst | undefined;
  if (!errors.length) {
    try {
      ({ tableList, ast } = parseSelect(normalized, dialect));
      errors.push(...checkParsedQuery(ast));
    } catch {
      errors.push('The SQL could not be parsed for this database dialect.');
    }
  }

  const cteNames = new Set(
    (ast?.with ?? [])
      .map(cte => (typeof cte.name === 'string' ? cte.name : cte.name?.value))
      .filter((name): name is string => Boolean(name))
      .map(name => name.toLowerCase()),
  );
  const tables = [
    ...new Set(
      tableList
        .map(entry =>
          entry
            .replace(/^select::/, '')
            .replaceAll('::', '.')
            .replace(/^null\./i, ''),
        )
        .filter(entry => entry && entry !== '(.*)' && !cteNames.has(entry.toLowerCase())),
    ),
  ];
  if (allowedObjects.length && tables.some(table => !matchesAllowedObject(table, allowedObjects)))
    errors.push('The query references a table outside the configured allowlist.');

  return { valid: errors.length === 0, sql: normalized, tables, checks, errors };
}

/**
 * Guarantees the outermost query returns at most `maxRows` rows. A missing top-level LIMIT is
 * appended; a larger or non-literal one is enforced by wrapping the query. LIMITs inside
 * subqueries or CTEs never count as the outer bound.
 */
export function enforceRowLimit(sql: string, dialect: Dialect, maxRows: number) {
  const base = sql.trim().replace(/;\s*$/, '');
  let ast: SelectAst | undefined;
  try {
    ast = parseSelect(base, dialect).ast;
  } catch {
    ast = undefined;
  }
  let last = ast;
  while (last?._next) last = last._next;
  const values = last?.limit?.value ?? [];

  if (ast && !values.length) return `${base}\nLIMIT ${maxRows}`;
  // `LIMIT offset, count` puts the count second; `LIMIT count OFFSET n` puts it first.
  const count = last?.limit?.seperator === ',' ? values[1] : values[0];
  if (count?.type === 'number' && Number(count.value) <= maxRows) return base;
  return `SELECT * FROM (\n${base}\n) AS bounded_result\nLIMIT ${maxRows}`;
}
