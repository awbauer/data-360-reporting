import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { changedRates, effectiveRates, fmtCredits, fmtMoney, parseRows, RATE_CARD, USAGE_IDS, usageLabel, type RateOverrides, type UsageId } from '@shared/credits';
import { applyPrefill, emptyPlan, MAX_LINES, newLine, prefillLines, sanitizePlan, summarizePlan, type Plan, type PlanLine } from '@shared/plan';
import { api } from '../api';
import { Bars } from '../components/Bars';
import { LineChart } from '../components/charts';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useWorkbench } from '../context';
import { exportPlan } from '../lib/exports';
import { fmtNum } from '../lib/format';
import { knownRows } from '../lib/storage';
import { useRates } from '../lib/useRates';

type PlansState = Record<string, unknown>;

export interface PlanOrg {
  host: string;
  dataspace: string;
}

/** Reads what the org reports and turns it into starting lines. Throws only when nothing could be read. */
export type Prefill = () => Promise<{ lines: PlanLine[]; warnings: string[] }>;

// ----------------------------------------------------------------------------- connected entry

/** The planner inside the connected app: it can start from what the org reports. */
export function PlanConnected() {
  const wb = useWorkbench();
  const qc = useQueryClient();
  const host = wb.session.instanceHost ?? '';
  const ds = wb.dataspace;
  const prefill: Prefill = async () => {
    const warnings: string[] = [];
    const extras = await qc.fetchQuery({ queryKey: ['extras', host, ds], queryFn: () => api.extras(ds), staleTime: 5 * 60_000 });
    warnings.push(...extras.errors);
    // Identity resolution is a separate permission; losing it shouldn't lose the rest.
    const identity = await api.identity(ds).catch((e: Error) => {
      warnings.push(`Identity resolution: ${e.message}`);
      return [];
    });
    const lines = prefillLines({
      streams: extras.dataStreams?.items ?? [],
      segments: extras.segments?.items ?? [],
      identity,
      rowsOf: (name) => knownRows(host, ds, name),
    });
    return { lines, warnings };
  };
  return <PlanPage org={{ host, dataspace: ds }} prefill={prefill} />;
}

// ----------------------------------------------------------------------------- page

/** Loads the person's saved plan for this org (or the org-less one), then hands over to the editor. */
export function PlanPage({ org, prefill }: { org: PlanOrg | null; prefill?: Prefill }) {
  const key = org?.host ?? 'standalone';
  const plans = useQuery({ queryKey: ['state', 'plans'], queryFn: () => api.getState<PlansState>('plans'), staleTime: Infinity, retry: 0 });
  if (plans.isLoading) return <div className="hint">Loading your plan…</div>;
  const saved = sanitizePlan(plans.data?.value?.[key]);
  return <PlanEditor key={key} planKey={key} org={org} prefill={prefill} initial={saved ?? emptyPlan(org ? `${org.host} plan` : 'Untitled plan')} />;
}

function PlanEditor({ planKey, org, prefill, initial }: { planKey: string; org: PlanOrg | null; prefill?: Prefill; initial: Plan }) {
  const qc = useQueryClient();
  const { overrides, rates, price, currency, confirmed, save: saveRates } = useRates();
  const [plan, setPlan] = useState<Plan>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'warn' | 'info'; text: string[] } | null>(null);
  const [replace, setReplace] = useState(false);
  const [addUsage, setAddUsage] = useState<UsageId>('ingest-batch');
  const first = useRef(true);

  // Save the plan to the person's account shortly after they stop typing.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      const all = { ...((qc.getQueryData<{ value: PlansState }>(['state', 'plans'])?.value ?? {}) as PlansState), [planKey]: plan };
      qc.setQueryData(['state', 'plans'], { value: all, updatedAt: Date.now() });
      api.putState('plans', all).catch((e: unknown) => console.warn('Could not save the plan to your account', e));
    }, 1200);
    return () => clearTimeout(t);
  }, [plan, planKey, qc]);

  const summary = useMemo(() => summarizePlan(plan, rates), [plan, rates]);
  const set = (patch: Partial<Plan>) => setPlan((p) => ({ ...p, ...patch }));
  const setLine = (id: string, patch: Partial<PlanLine>) => setPlan((p) => ({ ...p, lines: p.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const orgLines = plan.lines.filter((l) => l.origin === 'org').length;

  const doPrefill = async () => {
    if (!prefill) return;
    setReplace(false);
    setBusy('Reading the org…');
    setNotice(null);
    try {
      const { lines, warnings } = await prefill();
      setPlan((p) => applyPrefill(p, lines));
      setNotice({
        kind: warnings.length ? 'warn' : 'info',
        text: [
          `Read ${lines.length} line${lines.length === 1 ? '' : 's'} from the org: data streams, identity resolution and segments. These are starting guesses from the last run and the current schedule; correct them.`,
          'Not read: activation, data transforms, calculated insights and queries. Add those by hand.',
          ...warnings,
        ],
      });
    } catch (e) {
      setNotice({ kind: 'warn', text: [`Could not read the org: ${(e as Error).message}`] });
    } finally {
      setBusy(null);
    }
  };

  const ctx = () => ({ host: org?.host ?? null, dataspace: org?.dataspace ?? null, at: new Date() });
  const doExport = async (format: 'xlsx' | 'md') => {
    setBusy('Exporting…');
    try {
      await exportPlan(format, plan, overrides, ctx());
    } catch (e) {
      setNotice({ kind: 'warn', text: [`Export failed: ${(e as Error).message}`] });
    } finally {
      setBusy(null);
    }
  };

  const money = (c: number) => (price ? fmtMoney(c * price, currency) : null);
  const top = plan.lines
    .map((l) => ({ l, c: summary.perLine.find((x) => x.id === l.id)?.month1 ?? 0 }))
    .filter((x) => x.c > 0)
    .sort((a, b) => b.c - a.c)
    .slice(0, 5);

  return (
    <div className="page">
      <div className="row wrap">
        <div className="grow">
          <h1>Credit plan</h1>
          <div className="muted small">
            {org ? <>Sizing for <b>{org.host}</b> · data space <b>{org.dataspace}</b></> : 'Not tied to an org: enter the volumes by hand.'}
            {' '}An estimate from row counts and a rate card, not a measurement or a quote.
          </div>
        </div>
        {prefill && (
          <button onClick={() => (orgLines ? setReplace(true) : void doPrefill())} disabled={Boolean(busy)} title="Reads data streams, identity resolution and segments: API calls only, no query credits">
            Fill from this org
          </button>
        )}
        <span className="row" role="group" aria-label="Export plan">
          <button onClick={() => void doExport('xlsx')} disabled={Boolean(busy) || !plan.lines.length}>Excel</button>
          <button onClick={() => void doExport('md')} disabled={Boolean(busy) || !plan.lines.length}>Markdown</button>
        </span>
      </div>

      {!confirmed && (
        <div className="alert warn" role="note">
          <b>The rates are unverified defaults.</b> They come from secondary summaries of Salesforce's rate cards, which I couldn't check against
          the originals, and the summaries disagree in places. Confirm them against the customer's contract (Rate card, below) before putting any
          number in front of a client. Exports say so until you do.
        </div>
      )}
      {busy && <div className="hint">{busy}</div>}
      {notice && (
        <div className={`alert ${notice.kind === 'warn' ? 'warn' : ''} small`} role="status">
          {notice.text.map((t, i) => <div key={i}>{t}</div>)}
        </div>
      )}

      <section className="card">
        <div className="row wrap" style={{ gap: 16 }}>
          <label className="grow" style={{ minWidth: 200 }}>
            Plan name
            <input value={plan.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} />
          </label>
          <label style={{ width: 150 }} title="How much the rows per run grow each month, compounding. Applies to every line.">
            Growth per month, %
            <input type="number" value={plan.growthPctPerMonth} min={-50} max={100} step={0.5} onChange={(e) => set({ growthPctPerMonth: Number(e.target.value) || 0 })} />
          </label>
          <label style={{ width: 130 }}>
            Horizon
            <select value={plan.months} onChange={(e) => set({ months: Number(e.target.value) })}>
              {[6, 12, 24, 36].map((m) => <option key={m} value={m}>{m} months</option>)}
            </select>
          </label>
        </div>
      </section>

      <div className="grid cols-2">
        <section className="card">
          <h2>{plan.lines.length ? 'What it comes to' : 'Start here'}</h2>
          {plan.lines.length ? (
            <>
              <div className="tiles-inline">
                <div>
                  <div className="num">{fmtCredits(summary.month1)}</div>
                  <div className="lbl">credits in the first month{money(summary.month1) ? ` · ${money(summary.month1)}` : ''}</div>
                </div>
                <div>
                  <div className="num">{fmtCredits(summary.total)}</div>
                  <div className="lbl">credits over {summary.monthly.length} months{money(summary.total) ? ` · ${money(summary.total)}` : ''}</div>
                </div>
              </div>
              <h3 style={{ margin: '12px 0 6px' }}>By usage type, first month</h3>
              <Bars
                items={summary.byUsage.map((u) => ({ label: usageLabel(u.usage), value: Math.round(u.credits), title: `${usageLabel(u.usage)}: ${fmtCredits(u.credits)} credits (${Math.round(u.share * 100)}%)` }))}
                empty="Every line is zero so far."
              />
              {top.length > 0 && (
                <>
                  <h3 style={{ margin: '12px 0 6px' }}>Biggest lines</h3>
                  <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
                    {top.map(({ l, c }) => <li key={l.id}>{l.label || usageLabel(l.usage)} <span className="muted">· {fmtCredits(c)} credits ({Math.round((c / summary.month1) * 100)}%)</span></li>)}
                  </ol>
                </>
              )}
            </>
          ) : (
            <div className="small">
              {prefill ? <>Use <b>Fill from this org</b> to start from its data streams, identity resolution and segments, or </> : 'Pre-sales sizing? '}
              add lines by hand below. Each line is one kind of work: how many rows it processes per run, and how often it runs. Unification and
              ingestion usually dominate; queries are the cheapest line by far at the default rates.
              {!org && <> Connected to an org? <Link to="/">Connect</Link> to start from what it reports.</>}
            </div>
          )}
        </section>

        <section className="card">
          <h2>Projection</h2>
          {plan.lines.length && summary.month1 > 0 ? (
            <LineChart
              points={summary.monthly.map((c, i) => ({ x: i + 1, y: Math.round(c), label: `${fmtNum(Math.round(c))} credits` }))}
              seriesName="Credits"
              xName="Month"
              ariaLabel={`Projected credits per month over ${summary.monthly.length} months`}
              formatX={(x) => `Month ${x}`}
            />
          ) : (
            <div className="muted small">Add lines with rows and runs to see the projection.</div>
          )}
          {plan.growthPctPerMonth === 0 && plan.lines.length > 0 && <div className="small muted">Flat: set a growth rate to model volumes rising.</div>}
        </section>
      </div>

      <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <div className="row wrap" style={{ padding: '12px 12px 0' }}>
          <h2 className="grow" style={{ margin: 0 }}>Lines ({plan.lines.length})</h2>
          <label className="small row" style={{ flexDirection: 'row', alignItems: 'center' }}>
            <select value={addUsage} onChange={(e) => setAddUsage(e.target.value as UsageId)} aria-label="Usage type for the new line">
              {RATE_CARD.usage.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
            </select>
          </label>
          <button onClick={() => setPlan((p) => ({ ...p, lines: [...p.lines, newLine(addUsage)] }))} disabled={plan.lines.length >= MAX_LINES}>Add line</button>
        </div>
        {plan.lines.length > 0 && (
          <table className="t">
            <thead>
              <tr>
                <th>Usage type</th><th>What</th><th style={{ textAlign: 'right' }}>Rows per run</th><th style={{ textAlign: 'right' }}>Runs per month</th>
                <th style={{ textAlign: 'right' }}>Credits / month</th><th />
              </tr>
            </thead>
            <tbody>
              {plan.lines.map((l) => {
                const c = summary.perLine.find((x) => x.id === l.id)?.month1 ?? 0;
                return (
                  <tr key={l.id}>
                    <td>
                      <select value={l.usage} onChange={(e) => setLine(l.id, { usage: e.target.value as UsageId })} aria-label={`Usage type for ${l.label}`}>
                        {RATE_CARD.usage.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                      </select>
                      <div className="small muted">{rates[l.usage].toLocaleString('en-US')} per million rows</div>
                    </td>
                    <td>
                      <input value={l.label} onChange={(e) => setLine(l.id, { label: e.target.value })} aria-label="Line description" maxLength={120} style={{ width: '100%' }} />
                      {l.note && <div className="small muted" style={{ marginTop: 2 }}>{l.origin === 'org' && <span className="badge" style={{ marginRight: 6 }}>from org</span>}{l.note}</div>}
                    </td>
                    <td style={{ textAlign: 'right' }}><RowsInput value={l.rowsPerRun} onChange={(n) => setLine(l.id, { rowsPerRun: n })} label={`Rows per run for ${l.label}`} /></td>
                    <td style={{ textAlign: 'right' }}>
                      <input type="number" min={0} step="any" value={l.runsPerMonth} onChange={(e) => setLine(l.id, { runsPerMonth: Math.max(0, Number(e.target.value) || 0) })} aria-label={`Runs per month for ${l.label}`} style={{ width: 90, textAlign: 'right' }} />
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtCredits(c)}</td>
                    <td><button className="link" onClick={() => setPlan((p) => ({ ...p, lines: p.lines.filter((x) => x.id !== l.id) }))} aria-label={`Remove ${l.label}`}>remove</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <RateCard overrides={overrides} onSave={saveRates} defaultOpen={!confirmed} />

      <ConfirmDialog
        open={replace}
        title="Read the org again?"
        confirmLabel="Replace them"
        onCancel={() => setReplace(false)}
        onConfirm={() => void doPrefill()}
      >
        <p style={{ margin: 0 }}>
          This replaces the <b>{orgLines}</b> line{orgLines === 1 ? '' : 's'} that came from the org, including any edits you made to them.
          Lines you added yourself are kept.
        </p>
      </ConfirmDialog>
    </div>
  );
}

// ----------------------------------------------------------------------------- inputs

/** Accepts `2.5m`, `500k`, `2,500,000`; shows the full number with separators when not being edited. */
function RowsInput({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) {
      const n = parseRows(draft);
      if (n !== null) onChange(n);
      setDraft(null);
    }
  };
  return (
    <input
      value={draft ?? value.toLocaleString('en-US')}
      onFocus={(e) => {
        setDraft(String(value));
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(null);
      }}
      inputMode="decimal"
      aria-label={label}
      title="Type 2.5m, 500k or 2,500,000"
      style={{ width: 130, textAlign: 'right' }}
    />
  );
}

function RateCard({ overrides, onSave, defaultOpen }: { overrides: RateOverrides; onSave: (o: RateOverrides) => Promise<void>; defaultOpen: boolean }) {
  const [draft, setDraft] = useState<{ rates: Record<string, string>; price: string; currency: string; confirmed: boolean }>(() => toDraft(overrides));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = fromDraft(draft);
  const effective = effectiveRates(overrides);
  const dirty = JSON.stringify(next) !== JSON.stringify(overrides);
  const changed = changedRates(next);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <details className="card" open={defaultOpen}>
      <summary><b>Rate card</b> <span className="muted small">· credits per million rows processed{changed.length ? ` · ${changed.length} changed` : ''}</span></summary>
      <div className="stack" style={{ marginTop: 10 }}>
        <div className="alert small">
          <b>Source:</b> {RATE_CARD.source} <span className="muted">(as of {RATE_CARD.asOf})</span>
        </div>
        <table className="t">
          <thead><tr><th>Usage type</th><th style={{ textAlign: 'right' }}>Credits per million rows</th><th>Counts</th></tr></thead>
          <tbody>
            {RATE_CARD.usage.map((u) => (
              <tr key={u.id}>
                <td>{u.label}{u.note && <div className="small muted">{u.note}</div>}</td>
                <td style={{ textAlign: 'right' }}>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={draft.rates[u.id] ?? ''}
                    placeholder={String(u.rate)}
                    onChange={(e) => setDraft((d) => ({ ...d, rates: { ...d.rates, [u.id]: e.target.value } }))}
                    aria-label={`Credits per million rows for ${u.label}`}
                    style={{ width: 110, textAlign: 'right', borderColor: effective[u.id] !== u.rate || draft.rates[u.id] ? 'var(--accent)' : undefined }}
                  />
                  <div className="small muted">default {u.rate.toLocaleString('en-US')}</div>
                </td>
                <td className="small">{u.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row wrap" style={{ gap: 16 }}>
          <label style={{ width: 200 }}>
            Price per credit (optional)
            <input type="number" min={0} step="any" value={draft.price} placeholder="from your contract" onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))} />
          </label>
          <label style={{ width: 90 }}>
            Currency
            <input value={draft.currency} maxLength={3} onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value.toUpperCase() }))} />
          </label>
        </div>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, color: 'var(--text)', fontSize: 13 }}>
          <input type="checkbox" checked={draft.confirmed} onChange={(e) => setDraft((d) => ({ ...d, confirmed: e.target.checked }))} style={{ width: 'auto' }} />
          I've checked these rates against the customer's contract
        </label>
        <div className="small muted">Volume tiers, sandbox discounts and storage (billed per terabyte) aren't modelled. If the contract has tiers, enter the blended rate you expect to pay.</div>
        {error && <div className="alert error small" role="alert">{error}</div>}
        <div className="row">
          <button className="primary" onClick={() => void save()} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save rates'}</button>
          <button onClick={() => setDraft(toDraft({}))} disabled={saving}>Reset to defaults</button>
        </div>
      </div>
    </details>
  );
}

function toDraft(o: RateOverrides) {
  return {
    rates: Object.fromEntries(USAGE_IDS.filter((id) => o.rates?.[id] !== undefined).map((id) => [id, String(o.rates![id])])) as Record<string, string>,
    price: o.pricePerCredit ? String(o.pricePerCredit) : '',
    currency: o.currency ?? 'USD',
    confirmed: Boolean(o.confirmed),
  };
}

function fromDraft(d: ReturnType<typeof toDraft>): RateOverrides {
  const rates: Partial<Record<UsageId, number>> = {};
  for (const u of RATE_CARD.usage) {
    const raw = d.rates[u.id];
    const n = raw === undefined || raw === '' ? NaN : Number(raw);
    // Only keep a rate that actually differs from the default.
    if (Number.isFinite(n) && n >= 0 && n <= 1e9 && n !== u.rate) rates[u.id] = n;
  }
  const price = Number(d.price);
  return {
    ...(Object.keys(rates).length ? { rates } : {}),
    ...(Number.isFinite(price) && price > 0 ? { pricePerCredit: price } : {}),
    ...(/^[A-Za-z]{3}$/.test(d.currency) && d.currency !== 'USD' ? { currency: d.currency.toUpperCase() } : {}),
    ...(d.confirmed ? { confirmed: true } : {}),
  };
}
