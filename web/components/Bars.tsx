import { fmtNum } from '../lib/format';

interface Item {
  label: string;
  value: number;
  title?: string;
  to?: string;
}

/** Horizontal bar list: label, proportional bar, value. */
export function Bars({ items, alt, empty = 'Nothing to show' }: { items: Item[]; alt?: boolean; empty?: string }) {
  if (!items.length) return <div className="muted small">{empty}</div>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="bars">
      {items.map((i) => (
        <div className="bar-row" key={i.label} title={i.title ?? `${i.label}: ${fmtNum(i.value)}`}>
          <div className="name">{i.label}</div>
          <div className="bar-track"><div className={`bar-fill${alt ? ' alt' : ''}`} style={{ width: `${(i.value / max) * 100}%` }} /></div>
          <div className="val">{fmtNum(i.value)}</div>
        </div>
      ))}
    </div>
  );
}
