import { useEffect, useRef, useState } from 'react';
import {
  buildDateHistogramSql,
  buildNumericHistogramSql,
  buildRangeSql,
  chooseDateUnit,
  chooseNumericBuckets,
  dateBars,
  DATE_UNITS,
  isDateType,
  isLinearType,
  numericBars,
  parseRange,
  type Bar,
  type DateUnit,
  type Range,
} from '@shared/histogram';
import { buildTopValuesSql, type FieldProfile } from '@shared/sql';
import type { CellValue, FieldMeta, ObjectMeta } from '@shared/types';
import { runToCompletion } from '../api';
import { fmtNum, fmtPct } from '../lib/format';
import { BarChart } from './charts';

interface Props {
  obj: ObjectMeta;
  field: FieldMeta;
  dataspace: string;
  /** From a cached profile: lets us skip the range query. */
  profile?: FieldProfile;
  totalRows?: number;
}

type View = 'hist' | 'top';
type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | { status: 'hist'; bars: Bar[]; range: Range; note: string }
  | { status: 'top'; rows: CellValue[][] };

/**
 * Value distribution for one field. Numbers and dates are bucketed into a histogram (the "top
 * values" of a continuous field is just noise); everything else shows its most common values.
 */
export function FieldDistribution({ obj, field, dataspace, profile, totalRows }: Props) {
  const linear = isLinearType(field.type);
  const date = isDateType(field.type);
  const [view, setView] = useState<View>(linear ? 'hist' : 'top');
  const [bins, setBins] = useState(20);
  const [unit, setUnit] = useState<'auto' | DateUnit>('auto');
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const range = useRef<Range | null>(null);
  const seq = useRef(0);
  const lastKey = useRef('');
  // Each scan reads the object once; record that when its size is known.
  const est = totalRows !== undefined ? { estRows: totalRows, estComplete: true } : {};

  useEffect(() => {
    const key = `${view}|${bins}|${unit}`;
    // React StrictMode re-runs effects in development; don't pay for the same scan twice.
    if (key === lastKey.current) return;
    lastKey.current = key;
    const mine = ++seq.current;
    const fresh = () => seq.current === mine;
    setLoad({ status: 'loading' });

    (async () => {
      try {
        if (view === 'top') {
          const r = await runToCompletion({ sql: buildTopValuesSql(obj, field.name, 10), dataspace, ...est }, { maxRows: 10 });
          if (fresh()) setLoad({ status: 'top', rows: r.rows });
          return;
        }
        if (!range.current) {
          if (profile && profile.min !== undefined && profile.max !== undefined && totalRows !== undefined) {
            range.current = { min: profile.min, max: profile.max, nonNull: profile.nonNull, total: totalRows };
          } else {
            const r = await runToCompletion({ sql: buildRangeSql(obj, field.name), dataspace, ...est }, { maxRows: 1 });
            range.current = parseRange(r.rows[0] ?? []);
          }
        }
        const rg = range.current;
        if (!rg.nonNull || rg.min === null || rg.max === null) {
          if (fresh()) setLoad({ status: 'empty' });
          return;
        }
        let bars: Bar[];
        let note: string;
        if (date) {
          const u = unit === 'auto' ? chooseDateUnit(rg.min, rg.max) : unit;
          const r = await runToCompletion({ sql: buildDateHistogramSql(obj, field.name, u), dataspace, ...est }, { maxRows: 5000 });
          bars = dateBars(rg.min, rg.max, u, r.rows);
          note = `bucketed by ${u}`;
        } else {
          const b = chooseNumericBuckets(Number(rg.min), Number(rg.max), bins);
          const r = await runToCompletion({ sql: buildNumericHistogramSql(obj, field.name, b), dataspace, ...est }, { maxRows: 5000 });
          bars = numericBars(b, r.rows);
          note = b.step === 1 ? 'one bucket per value' : `buckets of ${fmtNum(b.step)}`;
        }
        if (fresh()) setLoad({ status: 'hist', bars, range: rg, note });
      } catch (e) {
        if (fresh()) setLoad({ status: 'error', message: (e as Error).message });
      }
    })();
  }, [view, bins, unit, obj, field, dataspace, date, profile, totalRows]);

  return (
    <div className="chart-card">
      <div className="chart-controls">
        {linear && (
          <span className="seg" role="group" aria-label="View">
            <button type="button" aria-pressed={view === 'hist'} onClick={() => setView('hist')}>Histogram</button>
            <button type="button" aria-pressed={view === 'top'} onClick={() => setView('top')}>Top values</button>
          </span>
        )}
        {view === 'hist' && !date && (
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            Bins
            <select value={bins} onChange={(e) => setBins(Number(e.target.value))}>
              {[10, 20, 40].map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
        )}
        {view === 'hist' && date && (
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            Bucket
            <select value={unit} onChange={(e) => setUnit(e.target.value as 'auto' | DateUnit)}>
              <option value="auto">auto</option>
              {DATE_UNITS.map((u) => <option key={u}>{u}</option>)}
            </select>
          </label>
        )}
        {load.status === 'hist' && (
          <span>
            {fmtNum(load.range.nonNull)} values
            {load.range.total > load.range.nonNull && ` · ${fmtNum(load.range.total - load.range.nonNull)} null (${fmtPct((load.range.total - load.range.nonNull) / load.range.total)})`}
            {' · '}{load.note}
          </span>
        )}
      </div>

      {load.status === 'loading' && <div className="muted small">Running query…</div>}
      {load.status === 'error' && <div className="alert error small" role="alert">{load.message}</div>}
      {load.status === 'empty' && <div className="muted small">No non-null values to bucket.</div>}
      {load.status === 'hist' && (
        <BarChart bars={load.bars} seriesName="Rows" xName={field.label} ariaLabel={`Histogram of ${field.label}`} />
      )}
      {load.status === 'top' && (
        <div className="bars" style={{ maxWidth: 520 }}>
          {load.rows.map((r) => (
            <div className="bar-row" key={String(r[0])}>
              <div className="name mono">{r[0] === null ? 'null' : String(r[0])}</div>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${(Number(r[1]) / Number(load.rows[0]?.[1] || 1)) * 100}%` }} /></div>
              <div className="val">{fmtNum(Number(r[1]))}</div>
            </div>
          ))}
          {!load.rows.length && <div className="muted small">No values.</div>}
        </div>
      )}
    </div>
  );
}
