// Shared manager-UI widgets: a sortable/filterable data table, a 1–20 rating
// grid with uncertainty and explicit null handling, source/provenance tags, and
// a disclaimer banner. Brand-neutral PROJECT V styling (genre conventions only).
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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

  // Virtual scrolling: above this many rows, only the rows inside the scroll viewport (plus an
  // overscan) are put in the DOM, with spacer rows holding the scroll height. A big player list
  // (hundreds of generated prospects / free agents) then costs a screenful of DOM, not all of it.
  const VIRTUAL_MIN = 60;
  const OVERSCAN = 8;
  const virtual = sorted.length > VIRTUAL_MIN;
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const [rowH, setRowH] = useState(33);
  const [view, setView] = useState({ top: 0, h: 600 });
  const onScroll = useCallback(() => { const el = scrollRef.current; if (el) setView((v) => (v.top === el.scrollTop ? v : { ...v, top: el.scrollTop })); }, []);
  useLayoutEffect(() => {
    if (!virtual) return;
    const el = scrollRef.current; if (!el) return;
    const measure = () => {
      const first = bodyRef.current?.querySelector<HTMLElement>('tr[data-testid="dt-row"]');
      if (first && first.offsetHeight > 0) setRowH((h) => (Math.abs(h - first.offsetHeight) > 1 ? first.offsetHeight : h));
      setView((v) => (v.h === el.clientHeight ? v : { ...v, h: el.clientHeight }));
    };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, [virtual, sorted.length]);

  const total = sorted.length;
  const start = virtual ? Math.max(0, Math.floor(view.top / rowH) - OVERSCAN) : 0;
  const end = virtual ? Math.min(total, Math.ceil((view.top + view.h) / rowH) + OVERSCAN) : total;
  const padTop = start * rowH;
  const padBottom = Math.max(0, (total - end) * rowH);
  const slice = virtual ? sorted.slice(start, end) : sorted;

  return (
    <div className="dt-wrap">
      {filterKey && (
        <input className="dt-filter" placeholder={t('common.filter')} value={q} onChange={(e) => setQ(e.target.value)} data-testid="table-filter" />
      )}
      <div className="dt-scroll" ref={scrollRef} onScroll={virtual ? onScroll : undefined} style={virtual ? { maxHeight: 'min(68vh, 560px)' } : undefined} data-virtual={virtual || undefined}>
        <table className="dt">
          <thead>
            <tr>{columns.map((c) => (
              <th key={c.key} style={{ width: c.width }} onClick={() => c.sortValue && toggle(c.key)} className={c.sortValue ? 'sortable' : ''} data-testid={`th-${c.key}`}>
                {c.header}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
            ))}</tr>
          </thead>
          <tbody ref={bodyRef}>
            {padTop > 0 && <tr aria-hidden style={{ height: padTop }}><td colSpan={columns.length} style={{ padding: 0, border: 0 }} /></tr>}
            {slice.map((r, i) => {
              const id = rowId?.(r);
              return (
                <tr key={id ?? start + i} onClick={() => onRowClick?.(r)} className={`${onRowClick ? 'click' : ''} ${id && id === selectedId ? 'sel' : ''}`} data-testid="dt-row">
                  {columns.map((c) => <td key={c.key}>{c.render(r)}</td>)}
                </tr>
              );
            })}
            {padBottom > 0 && <tr aria-hidden style={{ height: padBottom }}><td colSpan={columns.length} style={{ padding: 0, border: 0 }} /></tr>}
          </tbody>
        </table>
      </div>
      <div className="dt-count muted small">{t('common.rows', { n: sorted.length })}</div>
    </div>
  );
}
