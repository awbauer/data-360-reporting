import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef } from 'react';
import type { CellValue, QueryColumn } from '@shared/types';

const ROW_H = 28;
const NUM_TYPES = /^(bigint|integer|smallint|double|float|numeric)$/i;

function text(v: CellValue | object): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

export function ResultsGrid({ columns, rows }: { columns: QueryColumn[]; rows: CellValue[][] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => ROW_H, overscan: 12 });

  const widths = useMemo(
    () =>
      columns.map((c, i) => {
        let max = c.name.length + 4;
        for (const r of rows.slice(0, 50)) max = Math.max(max, text(r[i] as CellValue).length);
        return Math.min(360, Math.max(90, max * 8 + 24));
      }),
    [columns, rows],
  );
  const total = 56 + widths.reduce((a, b) => a + b, 0);

  return (
    <div className="grid-scroll" ref={scroller} role="table" aria-rowcount={rows.length}>
      <div style={{ width: total }}>
        <div className="g-head" role="row">
          <div className="g-cell g-rownum" style={{ width: 56 }} />
          {columns.map((c, i) => (
            <div className="g-cell" role="columnheader" style={{ width: widths[i] }} key={`${c.name}-${i}`} title={`${c.name} (${c.type})`}>
              {c.name}
              <small>{c.type}</small>
            </div>
          ))}
        </div>
        <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
          {virt.getVirtualItems().map((vi) => {
            const r = rows[vi.index]!;
            return (
              <div className="g-row" role="row" key={vi.key} style={{ height: ROW_H, transform: `translateY(${vi.start}px)`, width: total }}>
                <div className="g-cell g-rownum" style={{ width: 56 }}>{vi.index + 1}</div>
                {columns.map((c, i) => {
                  const v = r[i] ?? null;
                  return (
                    <div className={`g-cell${typeof v === 'number' || NUM_TYPES.test(c.type) ? ' n' : ''}`} role="cell" style={{ width: widths[i] }} key={i} title={text(v)}>
                      {v === null ? <span className="null">null</span> : text(v)}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
