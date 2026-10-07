import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ACTIVITY, RATE_CARDS, UNIT_NAME, frequencyOf, newPlan, type RateCard, type RateCardId } from '@shared/credits';
import { actionToItem, type ActionCost, type Forecast } from '@shared/credit-forecast';
import { api } from '../../api';
import { useRateCard } from '../../lib/creditPrefs';
import { fmtCredits, fmtMoney, fmtNum } from '../../lib/format';

/** Which rate card inline estimates use; remembered in this browser. */
export function CardPicker() {
  const [card, setCard] = useRateCard();
  return (
    <select className="card-picker" aria-label="Rate card for estimates" value={card.id} onChange={(e) => setCard(e.target.value as RateCardId)}>
      {Object.values(RATE_CARDS).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

/** Credits, with list-price money beside them when the card has one and it's at least a cent. */
export function Credits({ value, card, unit }: { value: number; card: RateCard; unit?: string }) {
  const money = card.listPricePer100k !== undefined ? (value / 100_000) * card.listPricePer100k : 0;
  return (
    <>
      {fmtCredits(value)}{unit ? ` ${unit}` : ''}
      {money >= 0.01 && <span className="muted small"> ≈ {fmtMoney(money)}</span>}
    </>
  );
}

function Cost({ a, value, card }: { a: ActionCost; value: number | null; card: RateCard }) {
  if (a.free) return <span className="badge" title={a.note}>not billed</span>;
  if (a.unpriced) return <span className="badge bad" title={a.note}>not priced</span>;
  if (value === null) return <span className="muted">once</span>;
  return <Credits value={value} card={card} />;
}

const volume = (a: ActionCost) => {
  const act = ACTIVITY[a.kind];
  const per = act.continuous ? 'a day' : a.runsPerMonth ? 'a run' : '';
  const how = a.runsPerMonth && !act.continuous ? `, ${(frequencyOf(a.runsPerMonth)?.label ?? `${Math.round(a.runsPerMonth)} times a month`).toLowerCase()}` : '';
  return `${fmtNum(Math.round(a.units))} ${UNIT_NAME[act.unit]} ${per}${how}`.replace(/\s+,/, ',').trim();
};

/**
 * Common actions on one thing (object, insight, segment, query) and what each costs, on the rate
 * card chosen with the picker. `context` names the thing in plans the actions are added to.
 */
export function ForecastTable({ forecast, context }: { forecast: Forecast; context: string }) {
  const [card] = useRateCard();
  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table className="t forecast">
          <thead>
            <tr><th>Action</th><th>Volume</th><th className="num">Each run</th><th className="num">A month</th></tr>
          </thead>
          <tbody>
            {forecast.actions.map((a) => (
              <tr key={a.id}>
                <td>
                  {a.label}
                  {a.detail && <div className="small muted">{a.detail}</div>}
                </td>
                <td className="small">{volume(a)}</td>
                <td className="num"><Cost a={a} value={a.once} card={card} /></td>
                <td className="num">{a.runsPerMonth > 0 || a.free || a.unpriced ? <Cost a={a} value={a.monthly} card={card} /> : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AddToPlan actions={forecast.actions} context={context} />
    </>
  );
}

/** Reads-and-row-counts line: what the estimate is sized from, or what's missing. */
export function ReadsNote({ forecast, what }: { forecast: Forecast; what: string }) {
  const missing = forecast.reads.filter((r) => r.rows === null);
  if (!forecast.reads.length) return <div className="small muted">Couldn’t tell which objects {what} reads, so costs are per million rows.</div>;
  if (missing.length) {
    return (
      <div className="small muted">
        Priced per million rows: no cached row count for {missing.map((r) => r.name).join(', ')}. Count rows on the{' '}
        <Link to="/overview">Overview</Link> (or the object’s page) for this {what}’s figures.
      </div>
    );
  }
  return (
    <div className="small muted">
      Sized from cached row counts: {forecast.reads.map((r) => `${r.name} (${fmtNum(r.rows!)})`).join(', ')}.
    </div>
  );
}

/** The standard card: title, rate-card picker, what it's sized from, the actions, a caveat. */
export function ForecastCard({ title, forecast, context, what, children }: {
  title: string;
  forecast: Forecast;
  context: string;
  /** e.g. "object", "segment": used in the sizing note. */
  what: string;
  children?: ReactNode;
}) {
  const [card] = useRateCard();
  return (
    <section className="card forecast-card">
      <div className="row wrap" style={{ marginBottom: 6 }}>
        <h2 className="grow" style={{ margin: 0 }}>{title}</h2>
        <CardPicker />
      </div>
      {children}
      <ReadsNote forecast={forecast} what={what} />
      <ForecastTable forecast={forecast} context={context} />
      <div className="small muted" style={{ marginTop: 6 }}>
        Each figure prices the action on its own at the start of a month.{' '}
        {card.tiers ? 'Other usage of the same type that month moves Flex into cheaper tiers, so these are upper bounds. ' : ''}
        {card.listPricePer100k !== undefined ? `Money at list price (${fmtMoney(card.listPricePer100k)} per 100,000). ` : ''}
        <Link to="/credits">Plan it in Credits</Link>.
      </div>
    </section>
  );
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

/** Adds one of the actions to a credit plan (or a new one), as an activity with its assumption. */
function AddToPlan({ actions, context }: { actions: ActionCost[]; context: string }) {
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ['plans'], queryFn: api.plans.list });
  const [actionId, setActionId] = useState('');
  const [planId, setPlanId] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const action = actions.find((a) => a.id === (actionId || actions[0]?.id));
  const target = planId || plans.data?.[0]?.id || 'new';

  const add = async () => {
    if (!action) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const item = actionToItem(action, crypto.randomUUID(), context);
      if (target === 'new') {
        const plan = { ...newPlan(`${context} estimate`.slice(0, 120)), start: thisMonth(), items: [item] };
        const r = await api.plans.create(plan);
        setDone({ id: r.id, name: plan.name });
      } else {
        const s = await api.plans.get(target);
        await api.plans.save(target, { ...s.plan, items: [...s.plan.items, item] }, s.updatedAt);
        void qc.invalidateQueries({ queryKey: ['plan', target] });
        setDone({ id: target, name: s.plan.name });
      }
      void qc.invalidateQueries({ queryKey: ['plans'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="row wrap small add-to-plan">
      <span className="muted">Add</span>
      <select aria-label="Action to add to a plan" value={action?.id ?? ''} onChange={(e) => setActionId(e.target.value)}>
        {actions.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
      </select>
      <span className="muted">to</span>
      <select aria-label="Plan" value={target} onChange={(e) => setPlanId(e.target.value)}>
        {plans.data?.map((p) => <option key={p.id} value={p.id}>{p.name}{p.client ? ` (${p.client})` : ''}</option>)}
        <option value="new">A new plan</option>
      </select>
      <button onClick={() => void add()} disabled={busy || !action}>{busy ? 'Adding…' : 'Add to plan'}</button>
      {done && <span role="status">Added to <Link to={`/credits/${done.id}`}>{done.name}</Link>.</span>}
      {error && <span role="alert" style={{ color: 'var(--bad)' }}>{error}</span>}
    </div>
  );
}

/** A short inline estimate for helper text: "≈ 0.01 credits". */
export function CreditHint({ credits, prefix = '≈' }: { credits: number; prefix?: string }) {
  const [card] = useRateCard();
  return (
    <span className="credit-hint" title={`${card.name}, base rate. Switch rate card with the picker on any estimate card.`}>
      {prefix} {fmtCredits(credits)} {card.credits.replace(/s$/, '')}{Math.abs(credits - 1) < 1e-9 ? '' : 's'}
    </span>
  );
}
