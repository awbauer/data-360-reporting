import { useMemo } from 'react';
import { cardinalityText, neighbours } from '@shared/join';
import type { ObjectMeta } from '@shared/types';

const W = 640;
const NODE_W = 156;
const NODE_H = 30;
const MAX_NODES = 12;

const clip = (s: string, n = 22) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

interface Props {
  center: ObjectMeta;
  byName: Map<string, ObjectMeta>;
  onOpen: (name: string) => void;
}

/** First-hop neighbours of one object, laid out around it. The table below carries the same facts. */
export function RelationshipMap({ center, byName, onOpen }: Props) {
  const edges = useMemo(() => neighbours(center.name, center.relationships), [center]);
  const shown = edges.slice(0, MAX_NODES);
  if (!shown.length) return <div className="muted small">No relationships to draw.</div>;

  // A short strip for one or two neighbours; a full canvas once there are more to arrange.
  const H = shown.length <= 2 ? 120 : shown.length <= 6 ? 260 : 340;
  const cx = W / 2;
  const cy = H / 2;
  const rx = W / 2 - NODE_W / 2 - 12;
  const ry = H / 2 - NODE_H / 2 - 12;
  const place = (i: number) => {
    // One or two neighbours sit left/right (the canvas is wide); more start from the top.
    const t = (i / shown.length) * Math.PI * 2 - (shown.length > 2 ? Math.PI / 2 : 0);
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
  };

  /** Where the segment from the centre toward (x, y) crosses a node's border. */
  const edgeEnd = (fromX: number, fromY: number, toX: number, toY: number) => {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const s = Math.min(dx ? NODE_W / 2 / Math.abs(dx) : Infinity, dy ? NODE_H / 2 / Math.abs(dy) : Infinity);
    return { x: toX - dx * s, y: toY - dy * s };
  };

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`Relationships of ${center.label}`} style={{ width: '100%', height: 'auto', maxHeight: 380 }}>
        <defs>
          <marker id="rel-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
          </marker>
        </defs>
        {shown.map((e, i) => {
          const p = place(i);
          const first = e.rels[0]!;
          const outgoing = first.fromEntity === center.name;
          const a = edgeEnd(p.x, p.y, cx, cy); // centre border
          const b = edgeEnd(cx, cy, p.x, p.y); // neighbour border
          const [x1, y1, x2, y2] = outgoing ? [a.x, a.y, b.x, b.y] : [b.x, b.y, a.x, a.y];
          const label = `${cardinalityText(first.cardinality)}${e.rels.length > 1 ? ` +${e.rels.length - 1}` : ''}`;
          return (
            <g key={e.other}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--muted)" strokeWidth={1.5} markerEnd="url(#rel-arrow)" />
              {label && (
                <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 5} textAnchor="middle" fontSize={11} fill="var(--muted)" style={{ paintOrder: 'stroke', stroke: 'var(--surface)', strokeWidth: 4 }}>
                  {label}
                </text>
              )}
            </g>
          );
        })}
        {shown.map((e, i) => {
          const p = place(i);
          const o = byName.get(e.other);
          return (
            <g
              key={e.other}
              transform={`translate(${p.x - NODE_W / 2},${p.y - NODE_H / 2})`}
              role={o ? 'link' : undefined}
              tabIndex={o ? 0 : undefined}
              aria-label={o ? `Open ${o.label}` : `${e.other} (not in this data space)`}
              style={{ cursor: o ? 'pointer' : 'default' }}
              onClick={() => o && onOpen(o.name)}
              onKeyDown={(ev) => {
                if (o && (ev.key === 'Enter' || ev.key === ' ')) {
                  ev.preventDefault();
                  onOpen(o.name);
                }
              }}
            >
              <title>{o ? `${o.label} (${e.other})` : `${e.other}: not available in this data space`}</title>
              <rect width={NODE_W} height={NODE_H} rx={7} fill="var(--surface)" stroke="var(--border)" strokeWidth={1.5} strokeDasharray={o ? undefined : '4 3'} />
              <text x={NODE_W / 2} y={NODE_H / 2} textAnchor="middle" dominantBaseline="middle" fontSize={12} fill={o ? 'var(--text)' : 'var(--muted)'}>
                {clip(o?.label ?? e.other)}
              </text>
            </g>
          );
        })}
        <g transform={`translate(${cx - NODE_W / 2},${cy - NODE_H / 2})`}>
          <rect width={NODE_W} height={NODE_H} rx={7} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={2} />
          <text x={NODE_W / 2} y={NODE_H / 2} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={700} fill="var(--text)">
            {clip(center.label)}
          </text>
        </g>
      </svg>
      {edges.length > MAX_NODES && <div className="small muted">Showing {MAX_NODES} of {edges.length} related objects; the table lists all of them.</div>}
    </div>
  );
}
