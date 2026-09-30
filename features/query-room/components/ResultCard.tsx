import {
  Check,
  CircleAlert,
  Copy,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  Maximize2,
  Minimize2,
  Table2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { QueryResult } from '@/lib/types';
import { useCopy } from '../useCopy';
import { exportCsv, exportJson, exportXlsx, formatCell } from '../utils';
import SqlCode from './SqlCode';

function isNumericColumn(result: QueryResult, name: string) {
  let seen = false;
  for (const row of result.rows) {
    const value = row[name];
    if (value === null || value === undefined) continue;
    if (typeof value !== 'number' && typeof value !== 'bigint') return false;
    seen = true;
  }
  return seen;
}

export default function ResultCard({ result, sql }: { result: QueryResult; sql?: string }) {
  const [tab, setTab] = useState<'table' | 'sql'>('table');
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, copy] = useCopy();
  const numeric = new Set(
    result.columns.map(column => column.name).filter(name => isNumericColumn(result, name)),
  );

  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && setFullscreen(false);
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [fullscreen]);

  const summary = [
    `${result.rowCount} ${result.rowCount === 1 ? 'row' : 'rows'}`,
    result.durationMs ? `${result.durationMs} ms` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  const card = (
    <section
      className='card result-card'
      aria-label='Query result'
      onClick={event => event.stopPropagation()}
    >
      <div className='card-header'>
        <span className='card-title'>
          <Table2 size={15} />
          {summary}
        </span>
        <div className='card-tools'>
          {sql && (
            <div className='tabs' role='tablist' aria-label='Result view'>
              <button role='tab' aria-selected={tab === 'table'} onClick={() => setTab('table')}>
                Table
              </button>
              <button role='tab' aria-selected={tab === 'sql'} onClick={() => setTab('sql')}>
                SQL
              </button>
            </div>
          )}
          <button
            className='icon-btn'
            onClick={() => copy(tab === 'sql' && sql ? sql : JSON.stringify(result.rows, null, 2))}
            aria-label={tab === 'sql' ? 'Copy SQL' : 'Copy rows as JSON'}
            title={tab === 'sql' ? 'Copy SQL' : 'Copy rows as JSON'}
            disabled={!result.columns.length}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <ExportMenu result={result} />
          <button
            className='icon-btn'
            onClick={() => setFullscreen(current => !current)}
            aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
            title={fullscreen ? 'Exit full screen' : 'Full screen'}
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {tab === 'sql' && sql ? (
        <div className='result-sql'>
          <SqlCode sql={sql} />
        </div>
      ) : result.columns.length ? (
        <div className='table-wrap'>
          <table>
            <thead>
              <tr>
                {result.columns.map(column => (
                  <th
                    key={column.name}
                    className={numeric.has(column.name) ? 'num' : undefined}
                    scope='col'
                  >
                    {column.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, index) => (
                <tr key={index}>
                  {result.columns.map(column => {
                    const raw = row[column.name];
                    const value = formatCell(raw);
                    const className =
                      raw === null || raw === undefined
                        ? 'null'
                        : numeric.has(column.name)
                          ? 'num'
                          : undefined;
                    return (
                      <td key={column.name} className={className} title={value}>
                        {value}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className='result-note'>The query returned no columns.</div>
      )}

      {result.truncated && (
        <div className='result-note'>
          <CircleAlert size={13} />
          Showing the first {result.rowCount} rows. The result was cut at the configured row or size
          limit.
        </div>
      )}
    </section>
  );

  return fullscreen ? (
    <div className='fullscreen-backdrop' onClick={() => setFullscreen(false)}>
      {card}
    </div>
  ) : (
    card
  );
}

function ExportMenu({ result }: { result: QueryResult }) {
  const menuRef = useRef<HTMLDetailsElement>(null);

  // <details> does not close on outside clicks by itself.
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (menuRef.current?.open && !menuRef.current.contains(event.target as Node))
        menuRef.current.open = false;
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const run = (action: () => unknown) => () => {
    if (menuRef.current) menuRef.current.open = false;
    void action();
  };

  return (
    <details className='menu' ref={menuRef}>
      <summary className='icon-btn' aria-label='Download results' title='Download'>
        <Download size={14} />
      </summary>
      <div className='menu-list'>
        <button onClick={run(() => exportCsv(result))}>
          <FileText size={14} />
          CSV
        </button>
        <button onClick={run(() => exportJson(result))}>
          <FileJson size={14} />
          JSON
        </button>
        <button onClick={run(() => exportXlsx(result))}>
          <FileSpreadsheet size={14} />
          Excel (.xlsx)
        </button>
      </div>
    </details>
  );
}
