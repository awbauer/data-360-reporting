// Excel / Markdown export of a credit plan: the numbers and, as importantly, the assumptions and
// the rate card behind them, so an estimate pasted into a proposal can be checked later.
import {
  ACTIVITY,
  RATE_CARD,
  UNIT_NAME,
  estimate,
  frequencyOf,
  levers,
  monthLabel,
  type CreditPlan,
  type Estimate,
} from './credits';
import { tableToMarkdown, type Cell, type Table } from './report';

/** Whole credits, but keep cents on small numbers (a query on 1M rows is 3 credits). */
export const roundCredits = (x: number): number => (Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 100) / 100);
const share = (x: number, of: number) => (of > 0 ? Math.round((x / of) * 1000) / 10 : 0);

export function planTables(plan: CreditPlan, at: Date, est: Estimate = estimate(plan)): Table[] {
  const card = RATE_CARD;
  const lv = levers(plan, card, est);
  const money = (x: number) => `${Math.round(x).toLocaleString('en-US')} ${plan.currency ?? 'USD'}`;

  const about: Table = {
    name: 'summary',
    title: 'Summary',
    header: ['Item', 'Value'],
    rows: [
      ['Plan', plan.name],
      ...(plan.client ? [['Client', plan.client] as Cell[]] : []),
      ['Rate card', card.source],
      ['Contract start', plan.start ?? 'not set'],
      ['Months', plan.months],
      ['Annual growth of recurring volumes %', plan.growthPct],
      ['Entitlement (credits)', plan.entitlement ?? 'not set'],
      ['Price per 100,000 credits', plan.pricePer100k !== undefined ? `${plan.pricePer100k} ${plan.currency ?? 'USD'}` : 'not set'],
      ['Credits against the entitlement', roundCredits(est.total.pooled)],
      ['Production credits', roundCredits(est.total.production)],
      ['Sandbox credits', roundCredits(est.total.sandbox)],
      ['Estimated cost', est.cost !== null ? money(est.cost) : 'no price set'],
      ['Entitlement runs out', plan.entitlement === undefined ? 'no entitlement set' : est.exhaustedMonth ? monthLabel(plan, est.exhaustedMonth) : 'not within the plan'],
      ['Generated', at.toISOString().replace(/\.\d{3}Z$/, 'Z')],
      ['Note', 'An estimate from the activities and assumptions listed, priced with the rate card named above. Months are average months (365/12 days).'],
      ...(plan.notes ? [['Plan notes', plan.notes] as Cell[]] : []),
      ...est.warnings.map((w): Cell[] => ['Warning', w]),
    ],
  };

  const items: Table = {
    name: 'activities',
    title: 'Activities',
    header: [
      'Activity', 'Label', 'Environment', 'Billed as', 'Units per run (or per day)', 'Unit', 'Runs per month', 'Frequency', 'One-time units',
      'Start month', 'End month', 'Credits', 'Share %', 'Assumption', 'Source',
    ],
    rows: plan.items.map((it, i) => {
      const e = est.items[i]!;
      const a = ACTIVITY[it.kind];
      const billed = e.usageType ? card.usageTypes[e.usageType]!.label : e.free ? `Not billed: ${e.note ?? ''}`.trim() : `Not priced: ${e.note ?? ''}`.trim();
      return [
        a.label, it.label, it.env, billed, it.perRun, UNIT_NAME[a.unit], Math.round(it.runsPerMonth * 100) / 100,
        frequencyOf(it.runsPerMonth)?.label ?? 'custom', it.initial || null, monthLabel(plan, it.startMonth),
        it.endMonth ? monthLabel(plan, it.endMonth) : null, roundCredits(e.total), share(e.total, est.total.production + est.total.sandbox),
        it.assumption ?? null, it.source ?? null,
      ];
    }),
  };

  const monthly: Table = {
    name: 'monthly',
    title: 'By month',
    header: ['Month', 'Production', 'Sandbox', 'Against entitlement', 'Actual', 'Cumulative', 'Remaining'],
    rows: est.months.map((m) => [
      m.label, roundCredits(m.production), roundCredits(m.sandbox), roundCredits(m.pooled),
      m.actual !== null ? roundCredits(m.actual) : null, roundCredits(m.cumulative), m.remaining !== null ? roundCredits(m.remaining) : null,
    ]),
  };

  const tierName = (t: number) => (t === 0 ? 'Base' : `Tier ${t + 1}`);
  const usage: Table = {
    name: 'usage-types',
    title: 'By usage type',
    header: ['Usage type', 'Environment', 'Units', 'Unit', 'Credits', 'Share %', ...(card.tiers ? ['Highest tier reached'] : [])],
    rows: est.usage.map((u) => [
      u.label, u.env, Math.round(u.units), UNIT_NAME[u.unit], roundCredits(u.total), share(u.total, est.total.production + est.total.sandbox),
      ...(card.tiers ? [u.env === 'production' && !plan.overrides?.[u.id] ? tierName(Math.max(0, ...u.tier)) : 'no tiers'] : []),
    ]),
  };

  const rates: Table = {
    name: 'rate-card',
    title: `Rate card: ${card.name}, ${card.asOf}`,
    header: ['Usage type', 'Per', 'Production multiplier', 'Sandbox multiplier', 'Override (production)'],
    rows: Object.values(card.usageTypes).map((u) => [
      u.label,
      u.unit === 'compute' ? '1 compute unit' : `${u.unit === 'mb' || u.unit === 'gb' ? '1' : '1 million'} ${UNIT_NAME[u.unit]}`,
      u.production.length > 1 ? u.production.join(' / ') : u.production[0]!,
      u.sandbox,
      plan.overrides?.[u.id] ?? null,
    ]),
    ...(card.tiers ? { note: `Tiers per usage type on credits used in the calendar month: base up to ${card.tiers.map((t) => t.toLocaleString('en-US')).join(', then up to ')}, then the last tier. A run that crosses into a tier is billed entirely at that tier.` } : {}),
  };

  const leverTable: Table = {
    name: 'levers',
    title: 'Ways to cut the estimate',
    header: ['Change', 'Credits saved', 'Why'],
    rows: lv.map((l) => [l.title, roundCredits(l.saves), l.detail]),
  };

  return [about, items, monthly, usage, rates, ...(lv.length ? [leverTable] : [])];
}

export function planMarkdown(tables: Table[]): string {
  const [about, ...rest] = tables;
  const md = (v: Cell | undefined) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const head = about!.rows.map(([k, v]) => `- **${md(k)}:** ${md(v)}`).join('\n');
  const title = String(about!.rows[0]![1]);
  return [
    `# Credit estimate: ${md(title)}`,
    head,
    ...rest.map((t) => `## ${t.title}\n\n${t.note ? `${t.note}\n\n` : ''}${t.rows.length ? tableToMarkdown(t) : '_None._'}`),
  ].join('\n\n') + '\n';
}
