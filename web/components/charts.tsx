import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { fmtNum } from '../lib/format';

// Geometry in SVG user units; the SVG scales to its container.
const W = 640;
const H = 240;
const M = { t: 22, r: 14, b: 34, l: 54 };
const PW = W - M.l - M.r;
const PH = H - M.t - M.b;
const BAR_MAX = 24; // bars are thin marks: never fill the slot
const GAP = 2; // surface gap between adjacent bars

export interface BarDatum {
  label: string;
  value: number;
  title?: string;
}

export interface LinePoint {
  x: number;
  y: number;
  label: string;
}

/** Round-number ticks covering [min, max]. */
export function niceScale(min: number, max: number, target = 4): { lo: number; hi: number; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { lo: 0, hi: 1, ticks: [0, 1] };
  if (max === min) max = min + 1;
  const raw = (max - min) / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Number(t.toPrecision(12)));
  return { lo, hi, ticks };
}

const tickText = (v: number) => (Math.abs(v) >= 1e6 ? `${Number((v / 1e6).toPrecision(3))}M` : fmtNum(v));
const clip = (s: string, n = 12) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A row of x-axis labels thinned so they never collide. */
function pickEvery(n: number, max = 8): number {
  return Math.max(1, Math.ceil(n / max));
}

interface FrameProps {
  y: { lo: number; hi: number; ticks: number[] };
  yPos: (v: number) => number;
  children: React.ReactNode;
  svgProps?: React.SVGProps<SVGSVGElement>;
}

function Frame({ y, yPos, children, svgProps }: FrameProps) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="presentation" {...svgProps}>
      {y.ticks.map((t) => (
        <g key={t}>
          <line className="grid-line" x1={M.l} x2={W - M.r} y1={yPos(t)} y2={yPos(t)} />
          <text className="axis-text" x={M.l - 8} y={yPos(t)} textAnchor="end" dominantBaseline="middle">
            {tickText(t)}
          </text>
        </g>
      ))}
      {children}
    </svg>
  );
}

/** Data-end rounded to 4px, square where it meets the baseline. */
function barPath(x: number, base: number, end: number, w: number): string {
  const h = Math.abs(end - base);
  const r = Math.min(4, h / 2, w / 2);
  if (h === 0) return '';
  if (end <= base) {
    // grows upward
    return `M${x},${base} V${end + r} Q${x},${end} ${x + r},${end} H${x + w - r} Q${x + w},${end} ${x + w},${end + r} V${base} Z`;
  }
  return `M${x},${base} V${end - r} Q${x},${end} ${x + r},${end} H${x + w - r} Q${x + w},${end} ${x + w},${end - r} V${base} Z`;
}

interface TableProps {
  head: [string, string];
  rows: [string, number][];
}

function TableView({ head, rows }: TableProps) {
  return (
    <details>
      <summary className="small muted">Table view</summary>
      <div className="chart-table">
        <table className="t">
          <thead><tr><th>{head[0]}</th><th className="num">{head[1]}</th></tr></thead>
          <tbody>
            {rows.slice(0, 500).map(([l, v], i) => (
              <tr key={i}><td>{l}</td><td className="num">{fmtNum(v)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

interface CommonProps {
  /** What is plotted: names the single series, so no legend box is needed. */
  seriesName: string;
  xName?: string;
  ariaLabel: string;
}

// -------------------------------------------------------------------- bars

export function BarChart({ bars, seriesName, xName = 'Bucket', ariaLabel }: CommonProps & { bars: BarDatum[] }) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const n = bars.length;
  const geo = useMemo(() => {
    const vals = bars.map((b) => b.value);
    const y = niceScale(Math.min(0, ...vals), Math.max(0, ...vals));
    const yPos = (v: number) => M.t + PH - ((v - y.lo) / (y.hi - y.lo || 1)) * PH;
    const band = PW / Math.max(n, 1);
    const w = Math.min(BAR_MAX, Math.max(1, band - GAP));
    return { y, yPos, band, w, base: yPos(0), maxIdx: vals.indexOf(Math.max(...vals)) };
  }, [bars, n]);

  const onKey = (e: KeyboardEvent) => {
    if (!n) return;
    const keys: Record<string, number> = {
      ArrowRight: Math.min((active ?? -1) + 1, n - 1),
      ArrowLeft: Math.max((active ?? n) - 1, 0),
      Home: 0,
      End: n - 1,
    };
    if (e.key in keys) {
      e.preventDefault();
      setActive(keys[e.key]!);
    } else if (e.key === 'Escape') setActive(null);
  };

  const step = pickEvery(n);
  const a = active !== null ? bars[active] : undefined;
  const ax = active !== null ? M.l + active * geo.band + geo.band / 2 : 0;
  return (
    <div>
      <div
        className="chart"
        tabIndex={0}
        role="group"
        aria-label={`${ariaLabel}. Use the arrow keys to read each bar.`}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
      >
        <Frame y={geo.y} yPos={geo.yPos}>
          <line className="grid-line" x1={M.l} x2={W - M.r} y1={geo.base} y2={geo.base} />
          {bars.map((b, i) => {
            const x = M.l + i * geo.band + (geo.band - geo.w) / 2;
            return (
              <g key={i}>
                <path className={`bar${active === i ? ' hover' : ''}`} d={barPath(x, geo.base, geo.yPos(b.value), geo.w)} />
                {/* the hit area is the whole band, taller than the mark */}
                <rect
                  className="hit"
                  x={M.l + i * geo.band}
                  y={M.t}
                  width={geo.band}
                  height={PH + M.b}
                  onPointerMove={() => setActive(i)}
                  onPointerEnter={() => setActive(i)}
                >
                  <title>{b.title ?? `${b.label}: ${fmtNum(b.value)}`}</title>
                </rect>
              </g>
            );
          })}
          {n > 0 && geo.maxIdx >= 0 && (
            <text
              className="value-label"
              x={M.l + geo.maxIdx * geo.band + geo.band / 2}
              y={geo.yPos(bars[geo.maxIdx]!.value) - 6}
              textAnchor="middle"
            >
              {fmtNum(bars[geo.maxIdx]!.value)}
            </text>
          )}
          {bars.map((b, i) =>
            i % step === 0 ? (
              <text key={`x${i}`} className="axis-text" x={M.l + i * geo.band + geo.band / 2} y={H - M.b + 16} textAnchor="middle">
                {clip(b.label)}
              </text>
            ) : null,
          )}
        </Frame>
        {a && (
          <div className="chart-tip" style={{ left: `clamp(70px, ${(ax / W) * 100}%, calc(100% - 70px))`, top: `${(geo.yPos(Math.max(a.value, 0)) / H) * 100}%` }}>
            <div className="v"><i />{fmtNum(a.value)}</div>
            <div className="l">{xName}: {a.label}</div>
          </div>
        )}
        <div className="sr-only" role="status" aria-live="polite" id={`${id}-live`}>
          {a ? `${a.label}: ${fmtNum(a.value)} ${seriesName}` : ''}
        </div>
      </div>
      <TableView head={[xName, seriesName]} rows={bars.map((b) => [b.label, b.value])} />
    </div>
  );
}

// ------------------------------------------------------------------- lines

export function LineChart({
  points,
  seriesName,
  xName = 'x',
  ariaLabel,
  formatX,
}: CommonProps & { points: LinePoint[]; formatX: (x: number) => string }) {
  const svg = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const n = points.length;

  const geo = useMemo(() => {
    const ys = points.map((p) => p.y);
    const y = niceScale(Math.min(...ys), Math.max(...ys));
    const xs = points.map((p) => p.x);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const xPos = (v: number) => (x1 === x0 ? M.l + PW / 2 : M.l + ((v - x0) / (x1 - x0)) * PW);
    const yPos = (v: number) => M.t + PH - ((v - y.lo) / (y.hi - y.lo || 1)) * PH;
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${xPos(p.x).toFixed(1)},${yPos(p.y).toFixed(1)}`).join('');
    const area = n > 1 ? `${path}L${xPos(x1)},${yPos(y.lo)}L${xPos(x0)},${yPos(y.lo)}Z` : '';
    const ticks = n > 1 ? Array.from({ length: 5 }, (_, i) => x0 + ((x1 - x0) * i) / 4) : [x0];
    return { y, xPos, yPos, path, area, ticks };
  }, [points, n]);

  const nearest = (clientX: number) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box || !n) return;
    const sx = ((clientX - box.left) / box.width) * W;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(geo.xPos(points[i]!.x) - sx);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    setActive(best);
  };

  const onKey = (e: KeyboardEvent) => {
    if (!n) return;
    if (e.key === 'ArrowRight') setActive(Math.min((active ?? -1) + 1, n - 1));
    else if (e.key === 'ArrowLeft') setActive(Math.max((active ?? n) - 1, 0));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(n - 1);
    else if (e.key === 'Escape') setActive(null);
    else return;
    e.preventDefault();
  };

  const a = active !== null ? points[active] : undefined;
  const last = points[n - 1];
  return (
    <div>
      <div
        className="chart"
        tabIndex={0}
        role="group"
        aria-label={`${ariaLabel}. Use the arrow keys to read each point.`}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
      >
        <Frame y={geo.y} yPos={geo.yPos} svgProps={{ ref: svg, onPointerMove: (e) => nearest(e.clientX) }}>
          {geo.area && <path className="area" d={geo.area} />}
          <path className="line" d={geo.path} />
          {geo.ticks.map((t, i) => (
            <text key={i} className="axis-text" x={geo.xPos(t)} y={H - M.b + 16} textAnchor={i === 0 && n > 1 ? 'start' : i === geo.ticks.length - 1 && n > 1 ? 'end' : 'middle'}>
              {formatX(t)}
            </text>
          ))}
          {/* the end of the line is the one direct label */}
          {last && active === null && <circle className="dot" cx={geo.xPos(last.x)} cy={geo.yPos(last.y)} r={4} />}
          {a && (
            <>
              <line className="crosshair" x1={geo.xPos(a.x)} x2={geo.xPos(a.x)} y1={M.t} y2={M.t + PH} />
              <circle className="dot" cx={geo.xPos(a.x)} cy={geo.yPos(a.y)} r={5} />
            </>
          )}
        </Frame>
        {a && (
          <div className="chart-tip" style={{ left: `clamp(70px, ${(geo.xPos(a.x) / W) * 100}%, calc(100% - 70px))`, top: `${(geo.yPos(a.y) / H) * 100}%`, marginTop: -10 }}>
            <div className="v"><i />{fmtNum(a.y)}</div>
            <div className="l">{xName}: {a.label}</div>
          </div>
        )}
        <div className="sr-only" role="status" aria-live="polite">{a ? `${a.label}: ${fmtNum(a.y)} ${seriesName}` : ''}</div>
      </div>
      <TableView head={[xName, seriesName]} rows={points.map((p) => [p.label, p.y])} />
    </div>
  );
}
