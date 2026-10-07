import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ACTIVITIES,
  ACTIVITY,
  MAX_MONTHS,
  RATE_CARD,
  UNIT_NAME,
  estimate,
  levers,
  monthLabel,
  newItem,
  type ActivityKind,
  type CreditPlan,
  type Estimate,
  type Lever,
  type PlanItem,
  type RateCard,
} from '@shared/credits';
import { planActuals } from '@shared/consumption';
import { useConsumption } from '../../lib/consumption';
import { ApiError, api, type StoredPlan } from '../../api';
import { useOptionalWorkbench } from '../../context';
import { exportPlan } from '../../lib/exports';
import { fmtAgo, fmtCredits, fmtMoney, fmtPct } from '../../lib/format';
import { Bars } from '../Bars';
import { BarChart, LineChart } from '../charts';
import { QuantityInput } from '../QuantityInput';
import { ActivitiesTable, ActivityPicker } from './ActivitiesTable';
import { SeedDialog } from './SeedDialog';

type SaveState = 'saved' | 'pending' | 'saving' | 'conflict' | 'error';
const SAVE_DELAY = 800;
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'SEK', 'INR', 'SGD'];

/** Loads a plan fresh from the server each time it's opened, then hands it to the editor. */
export function PlanEditor({ id, onDuplicate, onDelete }: { id: string; onDuplicate: (p: CreditPlan) => void; onDelete: (p: CreditPlan) => void }) {
  const q = useQuery({ queryKey: ['plan', id], queryFn: () => api.plans.get(id), staleTime: 0, retry: false });
  const [generation, setGeneration] = useState(0);
  if (q.error) return <div className="alert error" role="alert">{q.error.message}</div>;
  if (!q.data || !q.isFetchedAfterMount) return <div className="hint">Loading plan…</div>;
  return (
    <Editor
      key={`${id}:${generation}`}
      stored={q.data}
      onReload={async () => {
        await q.refetch();
        setGeneration((g) => g + 1);
      }}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
    />
  );
}

function Editor({ stored, onReload, onDuplicate, onDelete }: {
  stored: StoredPlan;
  onReload: () => Promise<void>;
  onDuplicate: (p: CreditPlan) => void;
  onDelete: (p: CreditPlan) => void;
}) {
  const { id } = stored;
  const qc = useQueryClient();
  const wb = useOptionalWorkbench();
  const [plan, setPlan] = useState(stored.plan);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Autosave: edits are debounced, saves run one at a time against the version last saved, and
  // a save refused because someone saved elsewhere stops autosaving until the user decides.
  const latest = useRef(plan);
  const base = useRef(stored.updatedAt);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  /** Saves started and not yet finished, including ones queued behind another. */
  const inFlight = useRef(0);
  const blocked = useRef(false);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    inFlight.current++;
    chain.current = chain.current.then(async () => {
      try {
        if (blocked.current) return;
        // A name cleared mid-edit still saves (the field puts a name back when it loses focus).
        const sent = latest.current.name.trim() ? latest.current : { ...latest.current, name: 'Untitled plan' };
        setSaveState('saving');
        const r = await api.plans.save(id, sent, base.current);
        base.current = r.updatedAt;
        qc.setQueryData<StoredPlan>(['plan', id], (old) => (old ? { ...old, plan: sent, updatedAt: r.updatedAt } : old));
        void qc.invalidateQueries({ queryKey: ['plans'] });
        // Saved only if nothing was edited since: no edit waiting to be saved, no save queued.
        setSaveState(timer.current || inFlight.current > 1 ? 'pending' : 'saved');
      } catch (e) {
        if (e instanceof ApiError && e.code === 'conflict') {
          blocked.current = true;
          setSaveState('conflict');
        } else {
          setSaveError((e as Error).message);
          setSaveState('error');
        }
      } finally {
        inFlight.current--;
      }
    });
  }, [id, qc]);

  const update = useCallback(
    (fn: (p: CreditPlan) => CreditPlan) => {
      const next = fn(latest.current);
      latest.current = next;
      setPlan(next);
      if (blocked.current) return;
      setSaveState('pending');
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY);
    },
    [flush],
  );

  // Leaving the plan saves what's pending; closing the tab with unsaved edits asks first.
  useEffect(() => () => {
    if (timer.current) flush();
  }, [flush]);
  const stateRef = useRef(saveState);
  stateRef.current = saveState;
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (stateRef.current !== 'saved') e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const keepMine = async () => {
    try {
      const current = await api.plans.get(id);
      base.current = current.updatedAt;
      blocked.current = false;
      flush();
    } catch (e) {
      setSaveError((e as Error).message);
      setSaveState('error');
    }
  };

  const set = <K extends keyof CreditPlan>(k: K, v: CreditPlan[K] | undefined) =>
    update((p) => {
      const n = { ...p };
      if (v === undefined) delete n[k];
      else n[k] = v;
      return n;
    });
  const setItem = (itemId: string, patch: Partial<PlanItem>) =>
    update((p) => ({ ...p, items: p.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) }));
  const addItems = (items: PlanItem[]) => update((p) => ({ ...p, items: [...p.items, ...items] }));

  // Estimates follow a deferred copy so typing stays quick on big plans.
  const view = useDeferredValue(plan);
  const card = RATE_CARD;
  const est = useMemo(() => estimate(view, card), [view, card]);
  // Levers worth showing: at least 0.1% of the plan.
  const lv = useMemo(() => levers(view, card, est).filter((l) => l.saves >= est.total.pooled * 0.001), [view, card, est]);

  const doExport = (format: 'xlsx' | 'md') => {
    setExportError(null);
    exportPlan(format, latest.current).catch((e: Error) => setExportError(e.message));
  };

  return (
    <div className="page">
      <div className="row wrap plan-head">
        <input className="plan-name grow" aria-label="Plan name" value={plan.name} maxLength={120} onChange={(e) => set('name', e.target.value)} onBlur={() => !plan.name.trim() && set('name', 'Untitled plan')} />
        <input aria-label="Client" placeholder="Client" value={plan.client ?? ''} maxLength={120} onChange={(e) => set('client', e.target.value || undefined)} style={{ width: 180 }} />
        <SaveStatus state={saveState} />
        <div className="row" role="group" aria-label="Export">
          <button onClick={() => doExport('xlsx')}>Excel</button>
          <button onClick={() => doExport('md')}>Markdown</button>
        </div>
        <button onClick={() => onDuplicate(latest.current)} title="Copy this plan to try a different scenario">Duplicate</button>
        <button className="danger" onClick={() => onDelete(latest.current)}>Delete</button>
      </div>
      {saveState === 'conflict' && (
        <div className="alert warn" role="alert">
          This plan was saved in another tab or on another device after you opened it, so your changes here aren’t saved.
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={() => void onReload()}>Load the saved version</button>
            <button onClick={() => void keepMine()}>Keep mine (overwrite it)</button>
          </div>
        </div>
      )}
      {saveState === 'error' && (
        <div className="alert error" role="alert">
          Couldn’t save: {saveError} <button className="link" onClick={flush}>Try again</button>
        </div>
      )}
      {exportError && <div className="alert error small" role="alert">Export failed: {exportError}</div>}

      <Summary plan={view} est={est} />
      {est.warnings.map((w) => <div className="alert warn small" key={w}>{w}</div>)}

      <section className="card">
        <h2>Contract</h2>
        <div className="grid contract">
          <label>
            Contract start
            <input type="month" value={plan.start ?? ''} placeholder="YYYY-MM" onChange={(e) => {
              const v = e.target.value.trim();
              if (!v) set('start', undefined);
              else if (/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) set('start', v);
            }} />
          </label>
          <label>
            Months
            {/* Activities and actuals past the end are kept, so shortening the plan loses nothing. */}
            <NumberField value={plan.months} min={1} max={MAX_MONTHS} integer onChange={(m) => set('months', m)} />
          </label>
          <label>
            Flex Credits in the contract
            <QuantityInput className="" label="Credits in the contract" optional placeholder="not set" value={plan.entitlement} onChange={(v) => set('entitlement', v)} />
          </label>
          <label>
            Price per 100,000 credits
            <span className="row" style={{ gap: 4 }}>
              <QuantityInput className="" label="Price per 100,000 credits" optional placeholder="not set" value={plan.pricePer100k} onChange={(v) => set('pricePer100k', v)} />
              <select aria-label="Currency" value={plan.currency ?? 'USD'} onChange={(e) => set('currency', e.target.value)}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </span>
          </label>
          <label>
            Annual data growth %
            <NumberField value={plan.growthPct} min={-100} max={1000} onChange={(g) => set('growthPct', g)} />
          </label>
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>
          Priced in Flex Credits with the {card.name} (updated {card.asOf}). Growth compounds from the contract start and applies to recurring volumes, not one-time ones.
        </div>
        <label style={{ marginTop: 12 }}>
          Notes
          <textarea rows={2} maxLength={10_000} value={plan.notes ?? ''} onChange={(e) => set('notes', e.target.value || undefined)} placeholder="Scope, sources, open questions (included in exports)" />
        </label>
      </section>

      <section className="card">
        <div className="row wrap" style={{ marginBottom: 12 }}>
          <h2 className="grow" style={{ margin: 0 }}>Activities</h2>
          <ActivityPicker
            label="Add an activity"
            placeholder="Add an activity…"
            onChange={(kind: ActivityKind) => addItems([newItem(kind, crypto.randomUUID(), { startMonth: 1 })])}
          />
          {wb && <button onClick={() => setSeeding(true)}>Add from this org…</button>}
        </div>
        {plan.items.length ? (
          <ActivitiesTable
            plan={plan}
            est={est}
            card={card}
            onItem={setItem}
            onRemove={(itemId) => update((p) => ({ ...p, items: p.items.filter((it) => it.id !== itemId) }))}
            onDuplicate={(itemId) => update((p) => {
              const i = p.items.findIndex((it) => it.id === itemId);
              const copy = { ...p.items[i]!, id: crypto.randomUUID(), label: `${p.items[i]!.label} (copy)` };
              return { ...p, items: [...p.items.slice(0, i + 1), copy, ...p.items.slice(i + 1)] };
            })}
          />
        ) : (
          <div className="muted small">
            List what the client will run: ingestion, identity resolution, insights, segment refreshes, activations. Volumes accept
            shorthand like <code>2.5m</code>.{' '}
            {wb ? 'Or start from what this org already runs with “Add from this org”.' : 'Connect an org to start from what it already runs.'}
          </div>
        )}
      </section>

      {view.items.length > 0 && <Results plan={view} est={est} card={card} />}

      {lv.length > 0 && (
        <section className="card">
          <h2>Ways to cut the estimate</h2>
          <div className="small muted" style={{ marginBottom: 4 }}>Each is priced by re-running the estimate with the change. Apply one to edit that activity.</div>
          {lv.slice(0, 8).map((l) => (
            <LeverRow key={`${l.itemId}:${l.title}`} lever={l} of={est.total.pooled} onApply={() => setItem(l.itemId, l.patch)} />
          ))}
        </section>
      )}

      <Actuals plan={plan} est={est} onChange={(actuals) => set('actuals', actuals)} hint={
        wb ? <FillFromOrg plan={plan} onFill={(actuals) => set('actuals', actuals)} /> : null
      } />

      <RateCardDetails plan={plan} card={card} onOverride={(utId, v) => update((p) => {
        const o = { ...(p.overrides ?? {}) };
        if (v === undefined) delete o[utId];
        else o[utId] = v;
        const n: CreditPlan = { ...p, overrides: o };
        if (!Object.keys(o).length) delete n.overrides;
        return n;
      })} />

      {wb && <SeedDialog open={seeding} onClose={() => setSeeding(false)} onAdd={(items) => {
        addItems(items);
        setSeeding(false);
      }} />}
    </div>
  );
}

/** A number committed on blur or Enter, so typing "24" never passes through 2. Out-of-range input reverts. */
function NumberField({ value, min, max, integer, onChange }: { value: number; min: number; max: number; integer?: boolean; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = Number(text.trim());
    if (text.trim() && Number.isFinite(v) && v >= min && v <= max && (!integer || Number.isInteger(v))) {
      if (v !== value) onChange(v);
    } else setText(String(value));
  };
  return (
    <input
      inputMode={integer ? 'numeric' : 'decimal'}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function SaveStatus({ state }: { state: SaveState }) {
  const text: Record<SaveState, string> = { saved: 'Saved', pending: 'Unsaved changes', saving: 'Saving…', conflict: 'Not saved', error: 'Not saved' };
  return <span className={`save-state ${state}`} role="status" aria-live="polite">{text[state]}</span>;
}

function Tile({ num, label, sub, tone }: { num: string; label: string; sub?: ReactNode; tone?: 'bad' }) {
  return (
    <div className={`tile${tone ? ` ${tone}` : ''}`}>
      <div className="num">{num}</div>
      <div className="lbl">{label}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function Summary({ plan, est }: { plan: CreditPlan; est: Estimate }) {
  const last = est.months[est.months.length - 1]!;
  const ent = plan.entitlement;
  return (
    <div className="grid tiles">
      <Tile
        num={fmtCredits(est.total.pooled)}
        label={`Flex Credits over ${plan.months} month${plan.months === 1 ? '' : 's'}`}
        sub={`${fmtCredits(est.total.pooled / plan.months)} a month on average`}
      />
      <Tile
        num={est.cost !== null ? fmtMoney(est.cost, plan.currency) : '—'}
        label="Estimated cost"
        sub={est.cost !== null ? `at ${fmtMoney(plan.pricePer100k!, plan.currency)} per 100,000 credits` : 'Enter a price per 100,000 credits'}
      />
      {ent !== undefined && ent > 0 ? (
        <Tile
          num={fmtPct(last.cumulative / ent)}
          label="of the entitlement used"
          tone={est.exhaustedMonth ? 'bad' : undefined}
          sub={est.exhaustedMonth ? `Runs out in ${monthLabel(plan, est.exhaustedMonth)}` : `${fmtCredits(ent - last.cumulative)} left at the end`}
        />
      ) : (
        <Tile num="—" label="Entitlement" sub="Enter the contract’s credits to see how long they last" />
      )}
    </div>
  );
}

function Results({ plan, est, card }: { plan: CreditPlan; est: Estimate; card: RateCard }) {
  const ent = plan.entitlement;
  const all = est.total.production + est.total.sandbox;
  const tierName = (t: number) => (t === 0 ? 'base' : `tier ${t + 1}`);
  return (
    <>
      <div className="grid cols-2">
        <section className="card chart-card">
          <h2>Credits by month</h2>
          <div className="small muted" style={{ marginBottom: 6 }}>What draws on the entitlement, production and sandbox.</div>
          <BarChart
            bars={est.months.map((m) => ({ label: m.label, value: Math.round(m.pooled) }))}
            seriesName="Credits"
            xName="Month"
            ariaLabel="Estimated credits by month"
          />
        </section>
        <section className="card chart-card">
          <h2>Running total</h2>
          <div className="small muted" style={{ marginBottom: 6 }}>
            Uses actual consumption for months that have it{ent ? ', against the entitlement' : ''}.
          </div>
          <LineChart
            points={est.months.map((m) => ({ x: m.month, y: Math.round(m.cumulative), label: `${m.label}${m.actual !== null ? ' (actual)' : ''}` }))}
            seriesName="Credits to date"
            xName="Month"
            ariaLabel="Cumulative credits by month"
            formatX={(x) => monthLabel(plan, Math.round(x))}
            ticks={monthTicks(plan.months)}
            zero
            {...(ent ? { reference: { value: ent, label: `Entitlement ${fmtCredits(ent)}` } } : {})}
          />
        </section>
      </div>
      <section className="card">
        <h2>By usage type</h2>
        <Bars
          items={est.usage.filter((u) => u.total > 0).map((u) => ({
            label: `${u.label.replace(/^Data 360 /, '')}${u.env === 'sandbox' ? ' (sandbox)' : ''}`,
            value: Math.round(u.total),
          }))}
          empty="Nothing billed yet."
        />
        <details style={{ marginTop: 10 }}>
          <summary>Units, shares{card.tiers ? ' and tiers' : ''}</summary>
          <table className="t" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th>Usage type</th><th>Where</th><th className="num">Units</th><th className="num">Credits</th><th className="num">Share</th>
                {card.tiers && <th>Highest tier reached</th>}
              </tr>
            </thead>
            <tbody>
              {est.usage.map((u) => (
                <tr key={`${u.env}:${u.id}`}>
                  <td>{u.label}</td>
                  <td>{u.env}</td>
                  <td className="num">{fmtCredits(u.units)} {UNIT_NAME[u.unit]}</td>
                  <td className="num">{fmtCredits(u.total)}</td>
                  <td className="num">{all ? fmtPct(u.total / all) : ''}</td>
                  {card.tiers && <td>{u.env === 'sandbox' || plan.overrides?.[u.id] !== undefined ? 'no tiers' : tierName(Math.max(...u.tier))}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {card.tiers && (
            <div className="small muted" style={{ marginTop: 6 }}>
              Tiers are per usage type and reset each calendar month: base up to {fmtCredits(card.tiers[0]!)} credits in the month,
              then cheaper multipliers above {card.tiers.map((t) => fmtCredits(t)).join(', ')}. A run that crosses into a tier is billed entirely at that tier.
            </div>
          )}
        </details>
      </section>
    </>
  );
}

/** Up to five whole months to label, first and last included. */
function monthTicks(months: number): number[] {
  if (months <= 1) return [1];
  const step = Math.max(1, Math.ceil((months - 1) / 4));
  const ticks: number[] = [];
  for (let m = 1; m < months; m += step) ticks.push(m);
  if (months - ticks[ticks.length - 1]! < step / 2) ticks.pop();
  return [...ticks, months];
}

function LeverRow({ lever, of, onApply }: { lever: Lever; of: number; onApply: () => void }) {
  return (
    <div className="lever">
      <div className="grow">
        <div><b>{lever.title}</b></div>
        <div className="small muted">{lever.detail}</div>
      </div>
      <div className="right">
        <div><b>−{fmtCredits(lever.saves)}</b></div>
        <div className="small muted">{of ? fmtPct(lever.saves / of) : ''} of the plan</div>
      </div>
      <button onClick={onApply}>Apply</button>
    </div>
  );
}

/**
 * Fills the plan's actuals from the connected org's consumption feeds: each complete month since the
 * contract start, for the chosen consumption cards. Sandbox counts only where the card pools it.
 */
function FillFromOrg({ plan, onFill }: { plan: CreditPlan; onFill: (a: CreditPlan['actuals']) => void }) {
  const c = useConsumption();
  const data = c.data;
  const allCards = useMemo(() => [...new Set((data?.monthly ?? []).map((m) => m.card).filter((x): x is string => Boolean(x)))].sort(), [data]);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  // Default to the Data 360 cards when the feed has several (an Agentforce card shouldn't count here).
  const dataLike = allCards.filter((x) => /data|360|cdp/i.test(x));
  const cards = picked ?? new Set(dataLike.length ? dataLike : allCards);
  const [done, setDone] = useState<string | null>(null);
  if (!c.sources.length) {
    return <div className="small muted">This data space has no consumption feeds to fill these from (<Link to="/credits/actual">where they come from</Link>).</div>;
  }
  if (!c.pick.totals) return null;
  const fill = () => {
    if (!plan.start || !data) return;
    const d = new Date();
    const through = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    const rows = planActuals(data, plan.start, plan.months, { ...(allCards.length ? { cards } : {}), includeSandbox: true, through });
    const kept = plan.actuals.filter((a) => !rows.some((r) => r.month === a.month));
    onFill([...kept, ...rows.map((r) => ({ month: r.month, credits: Math.round(r.credits) }))].sort((a, b) => a.month - b.month));
    setDone(rows.length ? `Filled ${rows.length} month${rows.length === 1 ? '' : 's'}.` : 'No complete month of consumption falls inside this plan yet.');
  };
  return (
    <div className="alert small stack" style={{ gap: 8 }}>
      <div>
        <b>From this org’s consumption.</b>{' '}
        {data
          ? <>Read {fmtAgo(data.at)} from <code>{data.sources.totals}</code>. Fills each complete month since the contract start, sandbox included (one Flex pool).</>
          : <>The org’s consumption feed (<code>{c.pick.totals.object.name}</code>) hasn’t been read in this browser yet.</>}
      </div>
      {allCards.length > 1 && (
        <div className="row wrap" role="group" aria-label="Cards to count">
          {allCards.map((x) => (
            <label key={x} className="row" style={{ flexDirection: 'row', gap: 4, color: 'var(--text)' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={cards.has(x)} onChange={(e) => {
                const n = new Set(cards);
                if (e.target.checked) n.add(x);
                else n.delete(x);
                setPicked(n);
              }} />
              {x}
            </label>
          ))}
        </div>
      )}
      <div className="row wrap">
        {data
          ? <button onClick={fill} disabled={!plan.start || (allCards.length > 0 && !cards.size)}>Fill actuals from consumption</button>
          : <button onClick={() => void c.load()} disabled={Boolean(c.progress)}>{c.progress ?? `Read consumption (${c.queries} small queries)`}</button>}
        {!plan.start && <span className="muted">Set the contract start first: months are matched to it.</span>}
        {done && <span role="status">{done}</span>}
      </div>
    </div>
  );
}

function Actuals({ plan, est, onChange, hint }: { plan: CreditPlan; est: Estimate; onChange: (a: CreditPlan['actuals']) => void; hint: ReactNode }) {
  const byMonth = new Map(plan.actuals.map((a) => [a.month, a.credits]));
  const setActual = (month: number, v: number | undefined) => {
    const rest = plan.actuals.filter((a) => a.month !== month);
    onChange(v === undefined ? rest : [...rest, { month, credits: v }].sort((a, b) => a.month - b.month));
  };
  return (
    <details className="card" open={plan.actuals.length > 0}>
      <summary><h2 style={{ display: 'inline' }}>Actual consumption</h2> <span className="small muted">({plan.actuals.length} month{plan.actuals.length === 1 ? '' : 's'} entered)</span></summary>
      <div className="stack" style={{ marginTop: 10 }}>
        <div className="small muted">
          Enter each month’s credits from Digital Wallet in Setup. A month with an actual uses it instead of the estimate in the running
          total, so the runway reflects what was really consumed.
        </div>
        {hint}
        <div style={{ overflowX: 'auto' }}>
          <table className="t" style={{ maxWidth: 640 }}>
            <thead><tr><th>Month</th><th className="num">Estimate</th><th className="num">Actual</th><th className="num">Difference</th></tr></thead>
            <tbody>
              {est.months.map((m) => {
                const a = byMonth.get(m.month);
                return (
                  <tr key={m.month}>
                    <td>{m.label}</td>
                    <td className="num">{fmtCredits(m.pooled)}</td>
                    <td className="num"><QuantityInput label={`Actual credits for ${m.label}`} optional placeholder="—" value={a} onChange={(v) => setActual(m.month, v)} /></td>
                    <td className="num">{a !== undefined && m.pooled > 0 ? `${a >= m.pooled ? '+' : '−'}${fmtPct(Math.abs(a / m.pooled - 1))}` : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

function RateCardDetails({ plan, card, onOverride }: { plan: CreditPlan; card: RateCard; onOverride: (usageType: string, v: number | undefined) => void }) {
  const per = (u: RateCard['usageTypes'][string]) => (u.unit === 'compute' ? '1 compute unit' : `${u.unit === 'mb' || u.unit === 'gb' ? '1' : '1M'} ${UNIT_NAME[u.unit]}`);
  return (
    <details className="card">
      <summary><h2 style={{ display: 'inline' }}>Rate card: {card.name}</h2></summary>
      <div className="stack" style={{ marginTop: 10 }}>
        <div className="small muted">
          Data 360 multipliers from the {card.source}. Tiers apply per usage type to credits used in the calendar month; sandbox is
          flat. An override replaces a usage type’s production multiplier and its tiers, for a negotiated rate.
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="t">
            <thead><tr><th>Usage type</th><th>Per</th><th className="num">Production (base / tier 2 / 3 / 4)</th><th className="num">Sandbox</th><th className="num">Override</th></tr></thead>
            <tbody>
              {Object.values(card.usageTypes).map((u) => (
                <tr key={u.id}>
                  <td>{u.label}</td>
                  <td>{per(u)}</td>
                  <td className="num">{u.production.map((m) => fmtCredits(m)).join(' / ')}</td>
                  <td className="num">{fmtCredits(u.sandbox)}</td>
                  <td className="num"><QuantityInput label={`Override for ${u.label}`} optional placeholder="—" value={plan.overrides?.[u.id]} onChange={(v) => onOverride(u.id, v)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>How each activity bills</h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="t">
            <thead><tr><th>Activity</th><th>Billed as</th></tr></thead>
            <tbody>
              {ACTIVITIES.map((a) => {
                const m = card.map[a.kind];
                return (
                  <tr key={a.kind}>
                    <td>{ACTIVITY[a.kind].label}</td>
                    <td>
                      {m.usageType ? card.usageTypes[m.usageType]!.label : m.free ? <span className="badge">not billed</span> : <span className="badge bad">not priced</span>}
                      {m.note && <div className="small muted">{m.note}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
