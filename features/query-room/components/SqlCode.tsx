const KEYWORDS = new Set(
  (
    'select from where and or not in is null as on join left right inner outer full cross group by ' +
    'order having limit offset union all distinct with case when then else end asc desc between ' +
    'like ilike exists count sum avg min max coalesce cast true false over partition fetch first ' +
    'rows only interval lateral using natural recursive filter nulls'
  ).split(' '),
);

// Strings, quoted identifiers, numbers, words, other runs, and a catch-all so no text is dropped.
const TOKEN =
  /('(?:[^']|'')*'?|"(?:[^"]|"")*"?|`[^`]*`?|\b\d+(?:\.\d+)?\b|[A-Za-z_][\w$]*|[^\w'"`]+|[\s\S])/g;

function tokenClass(token: string) {
  if (token.startsWith("'")) return 'sql-string';
  if (/^\d/.test(token)) return 'sql-number';
  if (KEYWORDS.has(token.toLowerCase())) return 'sql-keyword';
  return undefined;
}

/** Lightweight SQL highlighting; rendering only, never used to interpret the query. */
export default function SqlCode({ sql }: { sql: string }) {
  const tokens = sql.match(TOKEN) ?? [sql];
  return (
    <pre className='code'>
      <code>
        {tokens.map((token, index) => (
          <span key={index} className={tokenClass(token)}>
            {token}
          </span>
        ))}
      </code>
    </pre>
  );
}
