// Shared manager-UI widgets: a sortable/filterable data table, a 1–20 rating
// grid with uncertainty and explicit null handling, source/provenance tags, and
// a disclaimer banner. Brand-neutral PROJECT V styling (genre conventions only).
import { useMemo, useState, type ReactNode } from 'react';
import { useT } from './i18n/index.tsx';

export function Disclaimer({ text, kind = 'warn' }: { text: string; kind?: 'warn' | 'info' }) {
  return <div className={`disclaimer-banner ${kind}`} data-testid="disclaimer">⚠ {text}</div>;
}

export function SourceTag({ type }: { type: string }) {
  const unsourced = /unsourced|stub|synthetic|estimate/i.test(type);
  return <span className={`srctag ${unsourced ? 'unsourced' : 'sourced'}`} title="provenance">{type}</span>;
}

export function Flag({ cc }: { cc: string | null }) {
  if (!cc) return <span className="flag muted">—</span>;
  return <span className="flag" title={cc}>{cc.toUpperCase()}</span>;
}

// 1–20 rating bar with an uncertainty whisker; null → explicit "estimate N/A".
export function Rating({ value20, uncertainty, reason }: { value20: number | null; uncertainty?: number | null; reason?: string }) {
  if (value20 == null) {
    return <span className="rating-null" title={reason ?? 'no qualifying sample'} data-testid="rating-null">est. N/A</span>;
  }
  const pct = (value20 / 20) * 100;
  const band = uncertainty != null ? Math.min(40, uncertainty * 100) : 0;
  return (
    <span className="rating" data-testid="rating">
      <span className="rating-num">{value20}</span>
      <span className="rating-track">
        <span className="rating-fill" style={{ width: `${pct}%` }} />
        {band > 0 && <span className="rating-band" style={{ left: `${Math.max(0, pct - band / 2)}%`, width: `${band}%` }} />}
      </span>
    </span>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => number | string;
  width?: string;
}

export function DataTable<T>({
  rows, columns, filterKey, initialSort, onRowClick, selectedId, rowId,
}: {
  rows: T[];
  columns: Column<T>[];
  filterKey?: (row: T) => string;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  onRowClick?: (row: T) => void;
  selectedId?: string;
  rowId?: (row: T) => string;
}) {
  const t = useT();
  const [sort, setSort] = useState(initialSort ?? { key: columns[0].key, dir: 'asc' as const });
  const [q, setQ] = useState('');

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    let out = rows;
    if (q && filterKey) out = out.filter((r) => filterKey(r).toLowerCase().includes(q.toLowerCase()));
    if (col?.sortValue) {
      out = [...out].sort((a, b) => {
        const av = col.sortValue!(a); const bv = col.sortValue!(b);
        const c = av < bv ? -1 : av > bv ? 1 : 0;
        return sort.dir === 'asc' ? c : -c;
      });
    }
    return out;
  }, [rows, columns, sort, q, filterKey]);

  const toggle = (key: string) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  return (
    <div className="dt-wrap">
      {filterKey && (
        <input className="dt-filter" placeholder={t('common.filter')} value={q} onChange={(e) => setQ(e.target.value)} data-testid="table-filter" />
      )}
      <div className="dt-scroll">
        <table className="dt">
          <thead>
            <tr>{columns.map((c) => (
              <th key={c.key} style={{ width: c.width }} onClick={() => c.sortValue && toggle(c.key)} className={c.sortValue ? 'sortable' : ''} data-testid={`th-${c.key}`}>
                {c.header}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const id = rowId?.(r);
              return (
                <tr key={id ?? i} onClick={() => onRowClick?.(r)} className={`${onRowClick ? 'click' : ''} ${id && id === selectedId ? 'sel' : ''}`} data-testid="dt-row">
                  {columns.map((c) => <td key={c.key}>{c.render(r)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="dt-count muted small">{t('common.rows', { n: sorted.length })}</div>
    </div>
  );
}
