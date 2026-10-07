import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ACTIVITY, UNIT_NAME, frequencyOf, type PlanItem } from '@shared/credits';
import { seedCandidates, type SeedCandidate } from '@shared/credits-seed';
import type { InsightDefinition } from '@shared/types';
import { api } from '../../api';
import { useWorkbench } from '../../context';
import { fmtNum } from '../../lib/format';
import { countCache } from '../../lib/storage';

const MAX_INSIGHTS = 60;

/**
 * Proposes activities from the connected org's streams, identity resolution, insights and
 * segments. Reads metadata and cached row counts only: no queries, no credits.
 */
export function SeedDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (items: PlanItem[]) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={titleId} className="wide" onCancel={(e) => { e.preventDefault(); onClose(); }} onClose={onClose}>
      {open && <SeedBody titleId={titleId} onClose={onClose} onAdd={onAdd} />}
    </dialog>
  );
}

function SeedBody({ titleId, onClose, onAdd }: { titleId: string; onClose: () => void; onAdd: (items: PlanItem[]) => void }) {
  const wb = useWorkbench();
  const qc = useQueryClient();
  const host = wb.session.instanceHost ?? '';
  const extras = useQuery({ queryKey: ['extras', host, wb.dataspace], queryFn: () => api.extras(wb.dataspace) });
  const insightObjects = useMemo(() => wb.objects.filter((o) => o.kind === 'ci').slice(0, MAX_INSIGHTS), [wb.objects]);
  const [insights, setInsights] = useState<InsightDefinition[] | null>(null);
  const [changePct, setChangePct] = useState(5);
  const [picked, setPicked] = useState<Set<string> | null>(null);

  // Insight definitions, three at a time, through the same cache the Explorer uses.
  useEffect(() => {
    let live = true;
    const out: InsightDefinition[] = [];
    let next = 0;
    const worker = async () => {
      while (live && next < insightObjects.length) {
        const o = insightObjects[next++]!;
        try {
          out.push(await qc.fetchQuery({ queryKey: ['insight', host, wb.dataspace, o.name], queryFn: () => api.insight(wb.dataspace, o.name), staleTime: 15 * 60_000 }));
        } catch {
          /* a missing definition just leaves that insight unsized */
        }
      }
    };
    void Promise.all([worker(), worker(), worker()]).then(() => live && setInsights(out));
    return () => {
      live = false;
    };
  }, [qc, host, wb.dataspace, insightObjects]);

  const counts = useMemo(() => {
    const c: Record<string, { rows: number; at: string }> = {};
    for (const o of wb.objects) {
      const v = countCache.get(host, wb.dataspace, o.name);
      if (v) c[o.name] = v;
    }
    return c;
  }, [wb.objects, host, wb.dataspace]);

  const loading = extras.isLoading || insights === null;
  const candidates = useMemo<SeedCandidate[]>(() => {
    if (loading) return [];
    let n = 0;
    return seedCandidates({
      objects: wb.objects,
      extras: extras.data ?? null,
      insights: insights ?? [],
      counts,
      changeRate: changePct / 100,
      // Stable ids, so ticks survive a change of the change rate; fresh ones are made on add.
      newId: () => `seed-${n++}`,
    });
  }, [loading, wb.objects, extras.data, insights, counts, changePct]);

  // Complete candidates start ticked; ones missing a row count start unticked.
  useEffect(() => {
    if (!loading && picked === null) setPicked(new Set(candidates.filter((c) => !c.incomplete).map((c) => c.item.id)));
  }, [loading, candidates, picked]);

  const chosen = candidates.filter((c) => picked?.has(c.item.id));
  const groups = [...new Set(candidates.map((c) => c.group))];
  const toggle = (ids: string[], on: boolean) =>
    setPicked((p) => {
      const s = new Set(p ?? []);
      for (const id of ids) {
        if (on) s.add(id);
        else s.delete(id);
      }
      return s;
    });
  const counted = Object.keys(counts).length;

  return (
    <div className="dlg">
      <h2 id={titleId}>Add activities from this org</h2>
      <p className="small muted" style={{ margin: 0 }}>
        From data space <b>{wb.dataspace}</b>’s metadata and the row counts cached in this browser ({counted} of {wb.objects.length} objects
        counted). This runs no queries. Each line says what it assumed; review the numbers before relying on them.
      </p>
      <div className="row wrap small">
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          Assume
          <input type="number" min={0} max={100} step={0.5} value={changePct} onChange={(e) => setChangePct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} style={{ width: 70 }} aria-label="Change rate percent" />
          % of rows change per incremental run
        </label>
      </div>
      {extras.error && <div className="alert warn small">Could not load streams and segments: {extras.error.message}</div>}
      {extras.data?.errors.map((e) => <div className="alert warn small" key={e}>{e}</div>)}
      {loading ? (
        <div className="hint">Reading streams, segments{insightObjects.length ? ` and ${insightObjects.length} insight definitions` : ''}…</div>
      ) : !candidates.length ? (
        <div className="alert">Nothing to add: this data space has no data streams, identity resolution, calculated insights or segments the API returned.</div>
      ) : (
        <div className="seed-list">
          {groups.map((g) => {
            const list = candidates.filter((c) => c.group === g);
            const ids = list.map((c) => c.item.id);
            const on = ids.filter((id) => picked?.has(id)).length;
            return (
              <section key={g}>
                <label className="seed-head">
                  <input
                    type="checkbox"
                    checked={on === ids.length}
                    ref={(el) => {
                      if (el) el.indeterminate = on > 0 && on < ids.length;
                    }}
                    onChange={(e) => toggle(ids, e.target.checked)}
                  />
                  <b>{g}</b> <span className="muted">({list.length})</span>
                </label>
                {list.map((c) => {
                  const a = ACTIVITY[c.item.kind];
                  return (
                    <label key={c.item.id} className="seed-item">
                      <input type="checkbox" checked={picked?.has(c.item.id) ?? false} onChange={(e) => toggle([c.item.id], e.target.checked)} />
                      <div>
                        <div>
                          <b>{c.item.label}</b> · {a.label}
                          {c.incomplete && <span className="badge bad" style={{ marginLeft: 6 }}>needs a volume</span>}
                        </div>
                        <div className="small">
                          {fmtNum(Math.round(c.item.perRun))} {UNIT_NAME[a.unit]} per {a.continuous ? 'day' : 'run'}
                          {!a.continuous && `, ${(frequencyOf(c.item.runsPerMonth)?.label ?? `${Math.round(c.item.runsPerMonth)} a month`).toLowerCase()}`}
                        </div>
                        {c.item.assumption && <div className="small muted">{c.item.assumption}</div>}
                      </div>
                    </label>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
      <footer>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!chosen.length} onClick={() => onAdd(chosen.map((c) => ({ ...c.item, id: crypto.randomUUID() })))}>
          Add {chosen.length} {chosen.length === 1 ? 'activity' : 'activities'}
        </button>
      </footer>
    </div>
  );
}
