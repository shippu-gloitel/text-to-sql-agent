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
  let tables: SchemaSnapshot['tables'] = [];

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
    } finally {
      await connection.end();
    }
  }

  const fingerprint = createHash('sha256')
    .update(JSON.stringify(tables))
    .digest('hex')
    .slice(0, 16);
  return { tables, fingerprint };
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

  const serialized = JSON.stringify(result.rows, (_, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  const truncated =
    result.rows.length > profile.maxRows ||
    Buffer.byteLength(serialized) > profile.maxResponseBytes;
  const rows = result.rows.slice(0, profile.maxRows);
  return {
    columns: result.columns,
    rows,
    rowCount: rows.length,
    truncated,
    durationMs: Math.round(performance.now() - started),
  };
}
