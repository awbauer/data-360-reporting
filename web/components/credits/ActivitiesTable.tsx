import { Fragment, useState } from 'react';
import {
  ACTIVITIES,
  ACTIVITY,
  DAILY,
  FREQUENCIES,
  UNIT_NAME,
  frequencyOf,
  monthLabel,
  type ActivityKind,
  type CreditPlan,
  type Estimate,
  type PlanItem,
  type RateCard,
} from '@shared/credits';
import { fmtCredits } from '../../lib/format';
import { QuantityInput } from '../QuantityInput';

const GROUPS = [...new Set(ACTIVITIES.map((a) => a.group))];

export function ActivityPicker({ value, onChange, label, placeholder, className }: {
  value?: ActivityKind;
  onChange: (k: ActivityKind) => void;
  label: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <select className={className} aria-label={label} value={value ?? ''} onChange={(e) => e.target.value && onChange(e.target.value as ActivityKind)}>
      {placeholder && <option value="">{placeholder}</option>}
      {GROUPS.map((g) => (
        <optgroup key={g} label={g}>
          {ACTIVITIES.filter((a) => a.group === g).map((a) => (
            <option key={a.kind} value={a.kind}>{a.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/**
 * The plan's activities, edited in place. The row holds what changes the number most; where it
 * runs, which months, and the assumption are in the row's details. Credits are for the whole plan.
 */
export function ActivitiesTable({ plan, est, card, onItem, onRemove, onDuplicate }: {
  plan: CreditPlan;
  est: Estimate;
  card: RateCard;
  onItem: (id: string, patch: Partial<PlanItem>) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const total = est.total.production + est.total.sandbox;
  const monthsFor = (it: PlanItem) => Array.from({ length: Math.max(plan.months, it.startMonth, it.endMonth ?? 0) }, (_, i) => i + 1);
  // The estimate may trail the plan by a render (it's computed from a deferred copy).
  const byId = new Map(est.items.map((e) => [e.id, e]));

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="t act-table">
        <thead>
          <tr>
            <th>Activity</th>
            <th className="num">Volume</th>
            <th>How often</th>
            <th className="num">One-time</th>
            <th className="num">Credits</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {plan.items.map((it) => {
            const e = byId.get(it.id);
            const a = ACTIVITY[it.kind];
            const unit = UNIT_NAME[a.unit];
            const preset = frequencyOf(it.runsPerMonth);
            const isOpen = open === it.id;
            const when = [
              it.startMonth > 1 ? `from ${monthLabel(plan, it.startMonth)}` : '',
              it.endMonth !== undefined ? `until ${monthLabel(plan, it.endMonth)}` : '',
            ].filter(Boolean).join(' ');
            return (
              <Fragment key={it.id}>
                <tr>
                  <td>
                    <input className="act-label" aria-label="Label" value={it.label} maxLength={200} onChange={(ev) => onItem(it.id, { label: ev.target.value })} />
                    <div className="row" style={{ gap: 6, marginTop: 4 }}>
                      <ActivityPicker
                        className="act-kind"
                        label="Activity"
                        value={it.kind}
                        onChange={(kind) => {
                          const next = ACTIVITY[kind];
                          onItem(it.id, {
                            kind,
                            ...(it.label === a.label ? { label: next.label } : {}),
                            ...(next.continuous ? { runsPerMonth: DAILY } : {}),
                          });
                        }}
                      />
                      {it.env === 'sandbox' && <span className="badge">sandbox</span>}
                      {when && <span className="small muted">{when}</span>}
                    </div>
                  </td>
                  <td className="num">
                    <QuantityInput label={`${unit} per ${a.continuous ? 'day' : 'run'}`} value={it.perRun} onChange={(v) => onItem(it.id, { perRun: v ?? 0 })} />
                    <div className="small muted">{unit} per {a.continuous ? 'day' : 'run'}</div>
                  </td>
                  <td>
                    {a.continuous ? (
                      <span className="small muted">Continuous</span>
                    ) : (
                      <>
                        <select
                          aria-label="How often"
                          value={preset?.id ?? 'custom'}
                          onChange={(ev) => {
                            const f = FREQUENCIES.find((x) => x.id === ev.target.value);
                            if (f) onItem(it.id, { runsPerMonth: f.runs });
                          }}
                        >
                          {FREQUENCIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                          <option value="custom">Custom…</option>
                        </select>
                        {!preset && (
                          <div className="row small muted" style={{ marginTop: 4 }}>
                            <QuantityInput label="Runs per month" className="q short" value={it.runsPerMonth} onChange={(v) => onItem(it.id, { runsPerMonth: v ?? 0 })} />
                            a month
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="num">
                    <QuantityInput label="One-time volume" value={it.initial || undefined} optional placeholder="none" onChange={(v) => onItem(it.id, { initial: v ?? 0 })} />
                    <div className="small muted">in {monthLabel(plan, it.startMonth)}</div>
                  </td>
                  <td className="num">
                    {!e ? (
                      <span className="muted">…</span>
                    ) : e.free ? (
                      <span className="badge" title={e.note}>not billed</span>
                    ) : e.unpriced ? (
                      <span className="badge bad" title={e.note}>not priced</span>
                    ) : (
                      <>
                        <b>{fmtCredits(e.total)}</b>
                        <div className="share" title={`${total ? Math.round((e.total / total) * 1000) / 10 : 0}% of the plan`}>
                          <i style={{ width: `${total ? (e.total / total) * 100 : 0}%` }} />
                        </div>
                        <div className="small muted">{card.usageTypes[e.usageType!]!.label.replace(/^Data 360 /, '')}</div>
                      </>
                    )}
                  </td>
                  <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    <button className="link" onClick={() => setOpen(isOpen ? null : it.id)} aria-expanded={isOpen} aria-label={`Details for ${it.label}`}>
                      {isOpen ? 'less' : 'details'}
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="act-more">
                    <td colSpan={6}>
                      <div className="grid cols-2">
                        <div className="stack">
                          <div className="row wrap">
                            <label>
                              Runs in
                              <select aria-label="Environment" value={it.env} onChange={(ev) => onItem(it.id, { env: ev.target.value as PlanItem['env'] })}>
                                <option value="production">Production</option>
                                <option value="sandbox">Sandbox</option>
                              </select>
                            </label>
                            <label>
                              First month
                              <select aria-label="First month" value={it.startMonth} onChange={(ev) => {
                                const startMonth = Number(ev.target.value);
                                onItem(it.id, { startMonth, ...(it.endMonth !== undefined && it.endMonth < startMonth ? { endMonth: startMonth } : {}) });
                              }}>
                                {monthsFor(it).map((m) => <option key={m} value={m}>{monthLabel(plan, m)}</option>)}
                              </select>
                            </label>
                            <label>
                              Last month
                              <select aria-label="Last month" value={it.endMonth ?? ''} onChange={(ev) => onItem(it.id, { endMonth: ev.target.value ? Number(ev.target.value) : undefined })}>
                                <option value="">End of plan</option>
                                {monthsFor(it).filter((m) => m >= it.startMonth).map((m) => <option key={m} value={m}>{monthLabel(plan, m)}</option>)}
                              </select>
                            </label>
                          </div>
                          <label>
                            Assumption (goes into the export)
                            <textarea rows={3} maxLength={2000} value={it.assumption ?? ''} onChange={(ev) => onItem(it.id, { assumption: ev.target.value || undefined })} placeholder="Where the volume and frequency come from" />
                          </label>
                        </div>
                        <div className="stack small">
                          <div className="muted">{a.hint}</div>
                          {e?.note && <div className="muted"><b>{card.name}:</b> {e.note}</div>}
                          {it.source && <div className="muted">From the org: {it.source}</div>}
                          <div className="row">
                            <button onClick={() => onDuplicate(it.id)}>Duplicate</button>
                            <button className="danger" onClick={() => onRemove(it.id)}>Remove</button>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
