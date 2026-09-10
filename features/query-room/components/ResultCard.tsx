import { useEffect, useState } from 'react';
import {
  Check,
  CircleAlert,
  CircleCheck,
  Copy,
  FileJson,
  FileSpreadsheet,
  FileText,
  Maximize2,
  Minimize2,
  Table2,
  Terminal,
} from 'lucide-react';
import type { QueryResult } from '@/lib/types';
import { exportCsv, exportJson, exportXlsx, formatCell } from '../utils';

export default function ResultCard({ result, sql }: { result: QueryResult; sql?: string }) {
  const [tab, setTab] = useState<'table' | 'details'>('table');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState<'data' | 'query' | null>(null);

  const copy = async (kind: 'data' | 'query', value: string) => {
    try {
      if (!navigator.clipboard) return;
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  };

  const copyableData = JSON.stringify(result.rows, null, 2);
  useEffect(() => {
    if (!isFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isFullscreen]);

  const card = (
    <div
      className={`result-card ${isFullscreen ? 'fullscreen-result-card' : ''}`}
      onClick={event => event.stopPropagation()}
    >
      <div className='result-head'>
        <div>
          <span className='result-kicker'>
            <CircleCheck size={14} />
            Query complete
          </span>
          <h3>
            {result.rowCount
              ? `Returned ${result.rowCount} row${result.rowCount === 1 ? '' : 's'}`
              : 'No rows found'}
          </h3>
        </div>
        <div className='export-actions'>
          <button className='export-button' onClick={() => exportCsv(result)}>
            <FileText size={14} />
            CSV
          </button>
          <button className='export-button' onClick={() => exportJson(result)}>
            <FileJson size={14} />
            JSON
          </button>
          <button
            className='export-button'
            onClick={async () => {
              setExporting(true);
              await exportXlsx(result);
              setExporting(false);
            }}
            disabled={exporting}
          >
            <FileSpreadsheet size={14} />
            {exporting ? '…' : 'XLSX'}
          </button>
        </div>
      </div>
      <div className='result-tabs'>
        <button className={tab === 'table' ? 'active' : ''} onClick={() => setTab('table')}>
          <Table2 size={14} />
          Data
        </button>
        <button className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}>
          <Terminal size={14} />
          Query details
        </button>
      </div>
      {tab === 'table' ? (
        <>
          <div className='data-toolbar'>
            <span>
              <Table2 size={13} />
              Result
            </span>
            <div className='data-toolbar-actions'>
              <button
                className='export-button'
                onClick={() => copy('data', copyableData)}
                disabled={!result.columns.length}
                title='Copy displayed rows as JSON'
              >
                {copied === 'data' ? <Check size={14} /> : <Copy size={14} />}
                {copied === 'data' ? 'Copied' : 'Copy'}
              </button>
              <button
                className='icon-button fullscreen-button'
                onClick={() => setIsFullscreen(current => !current)}
                aria-label={isFullscreen ? 'Exit fullscreen table' : 'Open table fullscreen'}
                title={isFullscreen ? 'Exit fullscreen table' : 'Open table fullscreen'}
              >
                {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
            </div>
          </div>
          <div className='table-scroll'>
            <table>
              <thead>
                <tr>
                  {result.columns.map(column => (
                    <th key={column.name} title={column.name}>
                      <span className='cell-value'>{column.name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, index) => (
                  <tr key={index}>
                    {result.columns.map(column => {
                      const value = formatCell(row[column.name]);
                      return (
                        <td key={column.name} title={value}>
                          <span className='cell-value'>{value}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {result.truncated && (
              <div className='truncated-note'>
                <CircleAlert size={14} />
                Showing the configured result limit. Refine your question for a smaller result.
              </div>
            )}
          </div>
        </>
      ) : (
        <div className='query-details'>
          <div className='metadata-grid'>
            <span>
              Rows returned<strong>{result.rowCount}</strong>
            </span>
            <span>
              Duration<strong>{result.durationMs}ms</strong>
            </span>
            <span>
              Columns<strong>{result.columns.length}</strong>
            </span>
            <span>
              Mode<strong>Read-only</strong>
            </span>
          </div>
          <div className='sql-block raw-query-block'>
            <div className='code-head'>
              <span>
                <Terminal size={14} />
                Validated read-only SQL
              </span>
              <div className='code-actions'>
                <button
                  className='icon-button'
                  aria-label='Copy raw query'
                  onClick={() => copy('query', sql ?? '')}
                  disabled={!sql}
                >
                  {copied === 'query' ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <button
                  className='icon-button fullscreen-button'
                  onClick={() => setIsFullscreen(current => !current)}
                  aria-label={
                    isFullscreen ? 'Exit fullscreen query details' : 'Open query details fullscreen'
                  }
                  title={
                    isFullscreen ? 'Exit fullscreen query details' : 'Open query details fullscreen'
                  }
                >
                  {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>
              </div>
            </div>
            <pre>{sql || 'The raw query is not available for this result.'}</pre>
          </div>
        </div>
      )}
    </div>
  );
  return isFullscreen ? (
    <div className='table-fullscreen-backdrop' onClick={() => setIsFullscreen(false)}>
      {card}
    </div>
  ) : (
    card
  );
}
