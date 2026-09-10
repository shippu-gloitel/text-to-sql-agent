import { createHash } from 'node:crypto';
import {
  connectionProfileSchema,
  type ConnectionProfile,
  type QueryColumn,
  type QueryResult,
  type SchemaSnapshot,
} from '../types';

type RawQueryResult = { rows: Record<string, unknown>[]; columns: QueryColumn[] };

function assertProfile(profile: ConnectionProfile) {
  return connectionProfileSchema.parse(profile);
}

export async function healthCheck(input: ConnectionProfile) {
  const profile = assertProfile(input);
  const started = performance.now();

  if (profile.dialect === 'sqlite') {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(profile.path, { readonly: true, fileMustExist: true });
    try {
      const version = db.prepare('SELECT sqlite_version() AS version').get() as { version: string };
      return {
        ok: true,
        version: version.version,
        latencyMs: Math.round(performance.now() - started),
        schemaAvailable: true,
      };
    } finally {
      db.close();
    }
  }

  if (profile.dialect === 'postgresql') {
    const { Client } = await import('pg');
    const client = new Client({
      host: profile.host,
      port: profile.port,
      database: profile.database,
      user: profile.username,
      password: profile.password,
      ssl: profile.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: profile.timeoutMs,
    });
    await client.connect();
    try {
      const result = await client.query('SELECT version() AS version');
      return {
        ok: true,
        version: String(result.rows[0]?.version ?? 'PostgreSQL'),
        latencyMs: Math.round(performance.now() - started),
        schemaAvailable: true,
      };
    } finally {
      await client.end();
    }
  }

  const mysql = await import('mysql2/promise');
  const connection = await mysql.createConnection({
    host: profile.host,
    port: profile.port,
    database: profile.database,
    user: profile.username,
    password: profile.password,
    ssl: profile.ssl ? {} : undefined,
    connectTimeout: profile.timeoutMs,
  });
  try {
    const [rows] = await connection.execute('SELECT VERSION() AS version');
    const version = (rows as Array<{ version: string }>)[0]?.version ?? 'MySQL';
    return {
      ok: true,
      version,
      latencyMs: Math.round(performance.now() - started),
      schemaAvailable: true,
    };
  } finally {
    await connection.end();
  }
}

export async function introspect(input: ConnectionProfile): Promise<SchemaSnapshot> {
  const profile = assertProfile(input);
  // eslint-disable-next-line no-useless-assignment
  let tables: SchemaSnapshot['tables'] = [];
  // eslint-disable-next-line no-useless-assignment
  let relationships: SchemaSnapshot['relationships'] = [];

  if (profile.dialect === 'sqlite') {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(profile.path, { readonly: true, fileMustExist: true });
    try {
      const names = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as Array<{ name: string }>;
      tables = names.map(({ name }) => ({
        name,
        columns: (
          db.prepare(`PRAGMA table_info(${quoteIdentifier(name, 'sqlite')})`).all() as Array<{
            name: string;
            type: string;
          }>
        ).map(column => ({ name: column.name, type: column.type || 'unknown' })),
      }));
      relationships = names.flatMap(({ name }) => {
        const foreignKeys = db
          .prepare(`PRAGMA foreign_key_list(${quoteIdentifier(name, 'sqlite')})`)
          .all() as Array<{ table: string; from: string; to: string }>;
        return foreignKeys.map(foreignKey => ({
          fromTable: name,
          fromColumn: foreignKey.from,
          toTable: foreignKey.table,
          toColumn: foreignKey.to,
        }));
      });
    } finally {
      db.close();
    }
  } else if (profile.dialect === 'postgresql') {
    const { Client } = await import('pg');
    const client = new Client({
      host: profile.host,
      port: profile.port,
      database: profile.database,
      user: profile.username,
      password: profile.password,
      ssl: profile.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: profile.timeoutMs,
    });
    await client.connect();
    try {
      const result = await client.query(
        `SELECT table_schema, table_name, column_name, data_type FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name, ordinal_position`,
      );
      tables = groupColumns(
        result.rows.map(row => ({
          schema: row.table_schema,
          name: row.table_name,
          column: row.column_name,
          type: row.data_type,
        })),
      );
      try {
        const foreignKeys = await client.query(
          `SELECT from_ns.nspname AS from_schema, from_table.relname AS from_table, from_column.attname AS from_column, to_ns.nspname AS to_schema, to_table.relname AS to_table, to_column.attname AS to_column FROM pg_constraint constraint_row JOIN pg_class from_table ON from_table.oid = constraint_row.conrelid JOIN pg_namespace from_ns ON from_ns.oid = from_table.relnamespace JOIN pg_class to_table ON to_table.oid = constraint_row.confrelid JOIN pg_namespace to_ns ON to_ns.oid = to_table.relnamespace JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS from_key(attnum, position) ON true JOIN LATERAL unnest(constraint_row.confkey) WITH ORDINALITY AS to_key(attnum, position) ON to_key.position = from_key.position JOIN pg_attribute from_column ON from_column.attrelid = constraint_row.conrelid AND from_column.attnum = from_key.attnum JOIN pg_attribute to_column ON to_column.attrelid = constraint_row.confrelid AND to_column.attnum = to_key.attnum WHERE constraint_row.contype = 'f' AND from_ns.nspname NOT IN ('pg_catalog', 'information_schema') ORDER BY from_ns.nspname, from_table.relname, constraint_row.conname, from_key.position`,
        );
        relationships = foreignKeys.rows.map(row => ({
          fromSchema: row.from_schema,
          fromTable: row.from_table,
          fromColumn: row.from_column,
          toSchema: row.to_schema,
          toTable: row.to_table,
          toColumn: row.to_column,
        }));
      } catch {
        relationships = [];
      }
    } finally {
      await client.end();
    }
  } else {
    const mysql = await import('mysql2/promise');
    const connection = await mysql.createConnection({
      host: profile.host,
      port: profile.port,
      database: profile.database,
      user: profile.username,
      password: profile.password,
      ssl: profile.ssl ? {} : undefined,
      connectTimeout: profile.timeoutMs,
    });
    try {
      const [rows] = await connection.execute(
        `SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name, COLUMN_NAME AS column_name, DATA_TYPE AS data_type FROM information_schema.columns WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        [profile.database],
      );
      tables = groupColumns(
        (rows as Array<Record<string, string>>).map(row => ({
          schema: row.table_schema,
          name: row.table_name,
          column: row.column_name,
          type: row.data_type,
        })),
      );
      try {
        const [foreignKeyRows] = await connection.execute(
          `SELECT TABLE_SCHEMA AS from_schema, TABLE_NAME AS from_table, COLUMN_NAME AS from_column, REFERENCED_TABLE_SCHEMA AS to_schema, REFERENCED_TABLE_NAME AS to_table, REFERENCED_COLUMN_NAME AS to_column FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`,
          [profile.database],
        );
        relationships = (foreignKeyRows as Array<Record<string, string>>).map(row => ({
          fromSchema: row.from_schema,
          fromTable: row.from_table,
          fromColumn: row.from_column,
          toSchema: row.to_schema,
          toTable: row.to_table,
          toColumn: row.to_column,
        }));
      } catch {
        relationships = [];
      }
    } finally {
      await connection.end();
    }
  }

  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ tables, relationships }))
    .digest('hex')
    .slice(0, 16);
  return { tables, relationships, fingerprint };
}

function groupColumns(rows: Array<{ schema: string; name: string; column: string; type: string }>) {
  const grouped = new Map<string, SchemaSnapshot['tables'][number]>();
  rows.forEach(row => {
    const key = `${row.schema}.${row.name}`;
    const table = grouped.get(key) ?? { schema: row.schema, name: row.name, columns: [] };
    table.columns.push({ name: row.column, type: row.type });
    grouped.set(key, table);
  });
  return [...grouped.values()];
}

function quoteIdentifier(value: string, dialect: 'sqlite' | 'postgresql' | 'mysql') {
  const quote = dialect === 'mysql' ? '`' : '"';
  return `${quote}${value.replaceAll(quote, quote + quote)}${quote}`;
}

export async function executeReadOnly(
  input: ConnectionProfile,
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult> {
  const profile = assertProfile(input);
  const started = performance.now();
  let result: RawQueryResult;

  if (profile.dialect === 'sqlite') {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(profile.path, { readonly: true, fileMustExist: true });
    try {
      db.pragma('query_only = ON');
      const statement = db.prepare(sql);
      const rows = statement.all(...params) as Record<string, unknown>[];
      result = { rows, columns: rows.length ? Object.keys(rows[0]).map(name => ({ name })) : [] };
    } finally {
      db.close();
    }
  } else if (profile.dialect === 'postgresql') {
    const { Client } = await import('pg');
    const client = new Client({
      host: profile.host,
      port: profile.port,
      database: profile.database,
      user: profile.username,
      password: profile.password,
      ssl: profile.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: profile.timeoutMs,
    });
    await client.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query(`SET LOCAL statement_timeout = ${Math.round(profile.timeoutMs)}`);
      const response = await client.query(sql, params);
      result = {
        rows: response.rows as Record<string, unknown>[],
        columns: response.fields.map(field => ({
          name: field.name,
          type: String(field.dataTypeID),
        })),
      };
      await client.query('ROLLBACK');
    } finally {
      await client.end();
    }
  } else {
    const mysql = await import('mysql2/promise');
    const connection = await mysql.createConnection({
      host: profile.host,
      port: profile.port,
      database: profile.database,
      user: profile.username,
      password: profile.password,
      ssl: profile.ssl ? {} : undefined,
      connectTimeout: profile.timeoutMs,
    });
    try {
      await connection.query('SET TRANSACTION READ ONLY');
      await connection.beginTransaction();
      const [rows, fields] = await connection.execute(
        sql,
        params as Array<string | number | null | boolean | Buffer>,
      );
      result = {
        rows: rows as Record<string, unknown>[],
        columns: (fields as Array<{ name: string }>).map(field => ({ name: field.name })),
      };
      await connection.rollback();
    } finally {
      await connection.end();
    }
  }

  const serializedRows = result.rows.map(row =>
    JSON.stringify(row, (_, value) => (typeof value === 'bigint' ? value.toString() : value)),
  );
  const rows: Record<string, unknown>[] = [];
  let responseBytes = 2;
  for (let index = 0; index < result.rows.length; index += 1) {
    const rowBytes = Buffer.byteLength(serializedRows[index]);
    const separatorBytes = rows.length ? 1 : 0;
    if (
      rows.length >= profile.maxRows ||
      responseBytes + separatorBytes + rowBytes > profile.maxResponseBytes
    )
      break;
    rows.push(result.rows[index]);
    responseBytes += separatorBytes + rowBytes;
  }
  const truncated = rows.length < result.rows.length;
  return {
    columns: result.columns,
    rows,
    rowCount: rows.length,
    truncated,
    durationMs: Math.round(performance.now() - started),
  };
}
