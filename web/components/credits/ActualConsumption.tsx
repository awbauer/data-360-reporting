import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { attributedCredits, planActuals, summarize, type Consumption, type ResourceRow, type Source } from '@shared/consumption';
import { fmtEstCredits } from '@shared/estimate';
import type { DataSpace } from '@shared/types';
import { api } from '../../api';
import { useOptionalWorkbench, useWorkbench } from '../../context';
import { useConsumption } from '../../lib/consumption';
import { fmtAgo, fmtCredits, fmtNum, fmtPct } from '../../lib/format';
import { Bars } from '../Bars';
import { BarChart } from '../charts';

const ROLE_LABEL: Record<string, string> = {
  date: 'date', credits: 'credits', usage: 'raw usage', card: 'card', usageType: 'usage type', env: 'environment',
  resourceType: 'resource type', resource: 'resource', rowDetail: 'row status', quantity: 'quantity',
};
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const lastFullMonth = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
};

/** What the org actually consumed, from Salesforce's consumption feeds in this data space. */
export function ActualConsumption() {
  const wb = useOptionalWorkbench();
  if (!wb) {
    return (
      <div className="page" style={{ maxWidth: 760 }}>
        <h1>Actual consumption</h1>
        <p style={{ margin: 0 }}>
          What an org has really consumed comes from its own consumption data (Digital Wallet’s feeds in Data 360).{' '}
          <Link to="/">Connect an org</Link> to read it.
        </p>
      </div>
    );
  }
  return <Connected />;
}

function Connected() {
  const wb = useWorkbench();
  const c = useConsumption();
  const usable = Boolean(c.pick.totals || c.pick.resources || c.pick.entitlement);

  return (
    <div className="page">
      <div className="row wrap">
        <div className="grow">
          <h1>Actual consumption</h1>
          <div className="muted small">
            Data space <b>{wb.dataspace}</b> · from Salesforce’s consumption feeds (Digital Wallet), not an estimate
            {c.data && <> · read {fmtAgo(c.data.at)}</>}
          </div>
        </div>
        {usable && (
          c.progress ? <span className="muted small">{c.progress}</span> : (
            <button className={c.data ? '' : 'primary'} onClick={() => void c.load()}>
              {c.data ? 'Read again' : 'Read consumption'} ({c.queries} {c.queries === 1 ? 'query' : 'queries'}
              {c.scanCredits !== null ? `, ≈ ${fmtEstCredits(c.scanCredits)} credits` : ''})
            </button>
          )
        )}
      </div>

      {!c.sources.length ? <NoSources /> : <SourcesCard sources={c.sources} />}
      {usable && !c.data && (
        <div className="alert small">
          Reading runs {c.queries} small queries against the feeds above: by month (13 months), by day (90 days), by resource (30 days)
          and purchases. Queries are billed like any other; these feeds hold one row per day or hour per card or resource, so it’s cheap.
          {c.scanCredits === null && ' Count their rows in the Explorer for an exact estimate.'}
        </div>
      )}
      {c.data?.errors?.map((e) => <div className="alert warn small" key={e}>Couldn’t read {e}</div>)}
      {c.data && <Results data={c.data} />}
    </div>
  );
}

function NoSources() {
  const wb = useWorkbench();
  const [others, setOthers] = useState<{ space: DataSpace; names: string[] }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try {
      const { findSources } = await import('@shared/consumption');
      const found = await Promise.all(
        wb.dataspaces.filter((d) => d.name !== wb.dataspace).map(async (space) => {
          try {
            return { space, names: findSources((await api.metadata(space.name)).objects).map((s) => s.object.name) };
          } catch {
            return { space, names: [] };
          }
        }),
      );
      setOthers(found);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card stack">
      <h2>No consumption data in this data space</h2>
      <p className="small" style={{ margin: 0 }}>
        Salesforce publishes what an org consumes as data lake objects: <code>TenantDailyEntitlementConsumption</code> (credits per day per
        card), <code>TenantHourlyEntitlementConsumption</code> (per hour, per segment, insight, stream or other resource),{' '}
        <code>TenantEntitlementTransaction</code> (credits bought) and usage events, which can also be mapped to the standard Tenant
        Consumption Insights and Glb Tenant Entitlement Transaction DMOs. None is in data space <b>{wb.dataspace}</b>. Add them to it in
        Data 360 (Data Spaces), or switch data space.
      </p>
      {wb.dataspaces.length > 1 && (
        <div className="row wrap">
          <button onClick={() => void check()} disabled={busy}>{busy ? 'Checking…' : 'Check the other data spaces'}</button>
          <span className="small muted">Reads their metadata only.</span>
        </div>
      )}
      {others && (
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {others.map((o) => (
            <li key={o.space.name}>
              <b>{o.space.label}</b>: {o.names.length ? <>{o.names.join(', ')} <button className="link" onClick={() => wb.setDataspace(o.space.name)}>switch to it</button></> : <span className="muted">none</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="small muted">
        Object and field names follow Salesforce’s{' '}
        <a href="https://www.salesforce.com/blog/data-360-credit-feedback-loop/" target="_blank" rel="noreferrer">Build a Credit Feedback Loop for Data 360</a>.
      </div>
    </section>
  );
}

function SourcesCard({ sources }: { sources: Source[] }) {
  return (
    <details className="card">
      <summary><b>Where this comes from</b> <span className="small muted">({sources.map((s) => s.object.label).join(', ')})</span></summary>
      <table className="t" style={{ marginTop: 8 }}>
        <thead><tr><th>Feed</th><th>Object</th><th>Fields found</th><th>Not found</th></tr></thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.object.name}>
              <td>{s.label}</td>
              <td><Link to={`/explorer/${encodeURIComponent(s.object.name)}`}>{s.object.label}</Link><div><code className="muted small">{s.object.name}</code></div></td>
              <td className="small">{Object.entries(s.fields).map(([r, f]) => <div key={r}>{ROLE_LABEL[r]}: <code>{f!.name}</code></div>)}</td>
              <td className="small muted">{s.missing.map((r) => ROLE_LABEL[r]).join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="small muted">
        Fields are matched by name, so a feed’s data lake object and its standard DMO both work. The hourly feed’s rows still being
        processed are left out, as Salesforce advises.
      </div>
    </details>
  );
}

function Results({ data }: { data: Consumption }) {
  const allCards = useMemo(() => [...new Set(data.monthly.map((m) => m.card).filter((x): x is string => Boolean(x)))].sort(), [data]);
  const [off, setOff] = useState<Set<string>>(new Set());
  const cards = off.size ? new Set(allCards.filter((x) => !off.has(x))) : undefined;
  const months = [...new Set(data.monthly.map((m) => m.month))].sort();
  const [from, setFrom] = useState<string>(months[0] ?? '');
  const s = useMemo(() => summarize(data, Date.now(), { ...(cards ? { cards } : {}), ...(from ? { from } : {}) }), [data, cards, from]);
  const runway = s.runwayDays !== null ? new Date(Date.now() + s.runwayDays * 86_400_000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;

  return (
    <>
      {allCards.length > 1 && (
        <div className="row wrap small" role="group" aria-label="Consumption cards">
          <span className="muted">Cards:</span>
          {allCards.map((card) => (
            <button
              key={card}
              type="button"
              className={`chip${off.has(card) ? '' : ' on'}`}
              aria-pressed={!off.has(card)}
              onClick={() => setOff((o) => {
                const n = new Set(o);
                if (!n.delete(card)) n.add(card);
                return n.size === allCards.length ? o : n;
              })}
            >
              {card}
            </button>
          ))}
        </div>
      )}

      <div className="grid tiles">
        <div className="tile"><div className="num">{fmtCredits(s.thisMonth)}</div><div className="lbl">this month so far</div><div className="sub">on course for {fmtCredits(s.projectedMonth)}</div></div>
        <div className="tile"><div className="num">{fmtCredits(s.lastMonth)}</div><div className="lbl">last month</div></div>
        <div className="tile"><div className="num">{fmtCredits(s.last30)}</div><div className="lbl">last 30 days</div><div className="sub">{fmtCredits(s.dailyAverage)} a day</div></div>
        {s.purchased !== null ? (
          <div className={`tile${s.remaining !== null && s.remaining < 0 ? ' bad' : ''}`}>
            <div className="num">{fmtCredits(s.remaining ?? 0)}</div>
            <div className="lbl">left of {fmtCredits(s.purchased)} purchased</div>
            <div className="sub">{s.remaining !== null && s.remaining < 0 ? 'overdrawn' : runway ? `runs out around ${runway} at this rate` : 'not running out at this rate'}</div>
          </div>
        ) : (
          <div className="tile"><div className="num">—</div><div className="lbl">purchased</div><div className="sub">no entitlement feed in this data space</div></div>
        )}
      </div>
      {s.purchased !== null && months.length > 0 && (
        <label className="row small" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -8 }}>
          Count consumption from
          <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Contract start">
            {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
          <span className="muted">(the contract start; data before {monthName(months[0]!)} wasn’t read)</span>
        </label>
      )}

      {!data.monthly.length && !data.daily.length && (
        <div className="alert small">No daily totals were read (this data space has no daily or event feed with credits), so only resources and purchases are shown.</div>
      )}
      {(data.monthly.length > 0 || data.daily.length > 0) && <div className="grid cols-2">
        <section className="card chart-card">
          <h2>Credits by month</h2>
          <div className="small muted" style={{ marginBottom: 6 }}>Production and sandbox together; the current month is partial.</div>
          <BarChart bars={s.byMonth.map((m) => ({ label: monthName(m.month), value: Math.round(m.production + m.sandbox) }))} seriesName="Credits" xName="Month" ariaLabel="Credits consumed by month" />
        </section>
        <section className="card chart-card">
          <h2>Credits by day</h2>
          <div className="small muted" style={{ marginBottom: 6 }}>Last 90 days, all cards. Spikes are worth a look at the resources below.</div>
          <BarChart bars={data.daily.map((d) => ({ label: d.day.slice(5), value: Math.round(d.credits) }))} seriesName="Credits" xName="Day" ariaLabel="Credits consumed by day" />
        </section>
      </div>}

      <div className="grid cols-2">
        <section className="card">
          <h2>By card</h2>
          <Bars items={s.byCard.map((x) => ({ label: x.card, value: Math.round(x.credits) }))} empty="No card in this feed." />
          {s.byMonth.some((m) => m.sandbox > 0) && (
            <div className="small muted" style={{ marginTop: 8 }}>
              Sandbox: {fmtCredits(s.byMonth.reduce((t, m) => t + m.sandbox, 0))} of {fmtCredits(s.byMonth.reduce((t, m) => t + m.production + m.sandbox, 0))} over the months read.
            </div>
          )}
        </section>
        <UseInPlan data={data} cards={cards} />
      </div>

      <TopResources rows={data.resources} since={data.resourcesSince} />
    </>
  );
}

/** Resources by credits, linked to their page in the workbench where one matches. */
function TopResources({ rows, since }: { rows: ResourceRow[]; since: string }) {
  const wb = useWorkbench();
  const host = wb.session.instanceHost ?? '';
  const extras = useQuery({ queryKey: ['extras', host, wb.dataspace], queryFn: () => api.extras(wb.dataspace) });
  const total = rows.reduce((t, r) => t + r.credits, 0);
  const link = (r: ResourceRow) => {
    const seg = extras.data?.segments?.items.find((x) => attributedCredits([r], [x.apiName, x.label]).matched.length);
    if (seg) return <Link to="/segments">{seg.label}</Link>;
    const obj = wb.objects.find((o) => attributedCredits([r], [o.name, o.label]).matched.length);
    if (obj) return <Link to={`/explorer/${encodeURIComponent(obj.name)}`}>{obj.label}</Link>;
    const stream = extras.data?.dataStreams?.items.find((x) => attributedCredits([r], [x.name, x.label]).matched.length);
    if (stream?.dataLakeObject) return <Link to={`/explorer/${encodeURIComponent(stream.dataLakeObject)}`}>{stream.label}</Link>;
    return null;
  };
  if (!rows.length) return null;
  return (
    <section className="card">
      <h2>What consumed it: top resources since {since}</h2>
      <div className="small muted" style={{ marginBottom: 8 }}>From the hourly feed. Links open the matching segment, insight, object or stream here.</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="t">
          <thead><tr><th>Resource</th><th>Type</th><th className="num">Credits</th><th className="num">Share</th></tr></thead>
          <tbody>
            {rows.slice(0, 50).map((r) => (
              <tr key={`${r.resourceType}|${r.resource}`}>
                <td>{(() => {
                  const l = link(r);
                  return l ? <>{l}<div><code className="muted small">{r.resource}</code></div></> : <code>{r.resource}</code>;
                })()}</td>
                <td>{r.resourceType ?? ''}</td>
                <td className="num">{fmtCredits(r.credits)}</td>
                <td className="num">
                  {total ? fmtPct(r.credits / total) : ''}
                  <div className="share"><i style={{ width: `${total ? (r.credits / total) * 100 : 0}%` }} /></div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 50 && <div className="small muted">{fmtNum(rows.length - 50)} more not shown.</div>}
    </section>
  );
}

/** Writes monthly actuals (and optionally the purchased credits) into a plan. */
function UseInPlan({ data, cards }: { data: Consumption; cards: Set<string> | undefined }) {
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ['plans'], queryFn: api.plans.list });
  const [planId, setPlanId] = useState('');
  const [entitlement, setEntitlement] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; id?: string } | null>(null);
  const target = planId || plans.data?.[0]?.id || '';
  const purchased = data.sources.entitlement ? data.entitlement.filter((e) => !cards || cards.has(e.card ?? '')).reduce((t, e) => t + e.credits, 0) : null;

  const fill = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const s = await api.plans.get(target);
      if (!s.plan.start) throw new Error('Set the plan’s contract start first: actuals are matched to its months.');
      const actuals = planActuals(data, s.plan.start, s.plan.months, { ...(cards ? { cards } : {}), includeSandbox: true, through: lastFullMonth() });
      const kept = s.plan.actuals.filter((a) => !actuals.some((x) => x.month === a.month));
      const plan = {
        ...s.plan,
        actuals: [...kept, ...actuals.map((a) => ({ ...a, credits: Math.round(a.credits) }))].sort((a, b) => a.month - b.month),
        ...(entitlement && purchased !== null ? { entitlement: Math.round(purchased) } : {}),
      };
      await api.plans.save(target, plan, s.updatedAt);
      void qc.invalidateQueries({ queryKey: ['plan', target] });
      void qc.invalidateQueries({ queryKey: ['plans'] });
      setMsg({ ok: true, id: target, text: actuals.length ? `Filled ${actuals.length} month${actuals.length === 1 ? '' : 's'} of “${s.plan.name}”.` : `No complete month of consumption falls inside “${s.plan.name}”.` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>Track a plan against it</h2>
      <div className="small muted">
        Writes each complete month’s credits into a plan’s actuals (matched by its contract start), so its running total and runway use
        what was really consumed. Sandbox is included: it draws on the same Flex Credits.
      </div>
      {plans.data?.length ? (
        <>
          <select aria-label="Plan to fill" value={target} onChange={(e) => setPlanId(e.target.value)}>
            {plans.data.map((p) => <option key={p.id} value={p.id}>{p.name}{p.client ? ` (${p.client})` : ''}</option>)}
          </select>
          {purchased !== null && (
            <label className="row small" style={{ flexDirection: 'row', gap: 6 }}>
              <input type="checkbox" checked={entitlement} onChange={(e) => setEntitlement(e.target.checked)} style={{ width: 'auto' }} />
              Set its entitlement to the {fmtCredits(purchased)} credits purchased
            </label>
          )}
          <div><button onClick={() => void fill()} disabled={busy || !target}>{busy ? 'Filling…' : 'Fill actuals'}</button></div>
        </>
      ) : (
        <div className="small">No plans yet. <Link to="/credits">Create one</Link> first.</div>
      )}
      {msg && (
        <div className={`small${msg.ok ? '' : ' alert error'}`} role={msg.ok ? 'status' : 'alert'}>
          {msg.text} {msg.ok && msg.id && <Link to={`/credits/${msg.id}`}>Open the plan</Link>}
        </div>
      )}
    </section>
  );
}
