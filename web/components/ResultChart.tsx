import { useMemo, useState } from 'react';
import { parseTimestamp } from '@shared/histogram';
import type { CellValue, QueryColumn } from '@shared/types';
import { fmtNum } from '../lib/format';
import { BarChart, LineChart, type BarDatum, type LinePoint } from './charts';

const NUMERIC_TYPES = /^(bigint|integer|smallint|double|float|numeric|decimal|real)$/i;
const DATE_TYPES = /date|timestamp/i;
const MAX_BARS = 100;
const MAX_POINTS = 2000;

const toNumber = (v: CellValue): number | null => {
  if (v === null || v === '' || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A column counts as numeric when its type says so, or every sampled value parses as a number. */
function isNumeric(col: QueryColumn, rows: CellValue[][], i: number): boolean {
  if (NUMERIC_TYPES.test(col.type)) return true;
  const sample = rows.slice(0, 50).map((r) => r[i] ?? null).filter((v) => v !== null);
  return sample.length > 0 && sample.every((v) => toNumber(v) !== null);
}

function isDate(col: QueryColumn, rows: CellValue[][], i: number): boolean {
  if (DATE_TYPES.test(col.type)) return true;
  const first = rows.find((r) => typeof r[i] === 'string')?.[i];
  return typeof first === 'string' && /^\d{4}-\d{2}-\d{2}/.test(first);
}

interface Props {
  columns: QueryColumn[];
  rows: CellValue[][];
  /** True when more rows exist than are loaded. */
  partial: boolean;
}

/** One measure against one dimension, from the rows already loaded in the browser. */
export function ResultChart({ columns, rows, partial }: Props) {
  const numeric = useMemo(() => columns.map((c, i) => isNumeric(c, rows, i)), [columns, rows]);
  const dates = useMemo(() => columns.map((c, i) => isDate(c, rows, i)), [columns, rows]);
  const firstY = numeric.findIndex((x, i) => x && !dates[i]);
  const [yIdx, setY] = useState(firstY);
  const defaultX = columns.findIndex((_, i) => i !== (yIdx >= 0 ? yIdx : firstY));
  const [xIdx, setX] = useState(defaultX < 0 ? 0 : defaultX);
  const [kind, setKind] = useState<'auto' | 'bar' | 'line'>('auto');

  const y = Math.min(Math.max(yIdx, 0), columns.length - 1);
  const x = Math.min(xIdx, columns.length - 1);
  const type = kind === 'auto' ? (dates[x] ? 'line' : 'bar') : kind;
  const yName = columns[y]?.name ?? '';
  const xName = columns[x]?.name ?? '';

  const data = useMemo(() => {
    if (firstY < 0 && !numeric[y]) return null;
    if (type === 'bar') {
      const bars: BarDatum[] = [];
      for (const r of rows) {
        const v = toNumber(r[y] ?? null);
        if (v !== null) bars.push({ label: String(r[x] ?? 'null'), value: v });
        if (bars.length >= MAX_BARS) break;
      }
      return { bars, truncated: rows.length > MAX_BARS };
    }
    const points: LinePoint[] = [];
    for (const r of rows) {
      const v = toNumber(r[y] ?? null);
      const raw = r[x] ?? null;
      const px = dates[x] ? parseTimestamp(raw) : toNumber(raw);
      if (v !== null && px !== null && Number.isFinite(px)) points.push({ x: px, y: v, label: dates[x] ? new Date(px).toISOString().slice(0, 16).replace('T', ' ').replace(/ 00:00$/, '') : fmtNum(px) });
    }
    points.sort((a, b) => a.x - b.x);
    return { points: points.slice(0, MAX_POINTS), truncated: points.length > MAX_POINTS };
  }, [rows, type, x, y, dates, numeric, firstY]);

  if (!columns.length || !rows.length) return <div className="hint">Run a query to chart its results.</div>;
  if (!data) return <div className="hint">Charts need a numeric column. Add an aggregate such as <code>COUNT(*)</code>, or cast a column to a number.</div>;

  const span = data.points && data.points.length > 1 ? data.points[data.points.length - 1]!.x - data.points[0]!.x : 0;
  const formatDate = (t: number) => new Date(t).toISOString().slice(0, span > 3 * 86_400_000 ? 10 : 16).replace('T', ' ');

  return (
    <div style={{ padding: 12, overflow: 'auto', height: '100%' }}>
      <div className="chart-controls">
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          X
          <select value={x} onChange={(e) => setX(Number(e.target.value))}>
            {columns.map((c, i) => <option key={i} value={i}>{c.name}</option>)}
          </select>
        </label>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          Y
          <select value={y} onChange={(e) => setY(Number(e.target.value))}>
            {columns.map((c, i) => numeric[i] && <option key={i} value={i}>{c.name}</option>)}
          </select>
        </label>
        <span className="seg" role="group" aria-label="Chart type">
          {(['auto', 'bar', 'line'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{k}</button>
          ))}
        </span>
        <span>
          {partial && 'Loaded rows only. '}
          {data.truncated && (type === 'bar' ? `Showing the first ${MAX_BARS} rows.` : `Showing ${fmtNum(MAX_POINTS)} points.`)}
        </span>
      </div>
      {type === 'bar' && data.bars && (
        <BarChart bars={data.bars} seriesName={yName} xName={xName} ariaLabel={`${yName} by ${xName}`} />
      )}
      {type === 'line' && data.points && (
        data.points.length ? (
          <LineChart
            points={data.points}
            seriesName={yName}
            xName={xName}
            ariaLabel={`${yName} over ${xName}`}
            formatX={dates[x] ? formatDate : (t) => fmtNum(Number(t.toPrecision(6)))}
          />
        ) : <div className="hint">No rows have both a numeric {yName} and a usable {xName}.</div>
      )}
    </div>
  );
}
