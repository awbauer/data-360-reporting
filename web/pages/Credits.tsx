import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RATE_CARD, newPlan, type CreditPlan } from '@shared/credits';
import { api } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PlanEditor } from '../components/credits/PlanEditor';
import { useOptionalWorkbench } from '../context';
import { fmtAgo } from '../lib/format';

const thisMonth = () => new Date().toISOString().slice(0, 7);

/**
 * Credit estimates per client: activities priced on a published rate card, run month by month
 * against the contract's entitlement. Works with or without a connected org.
 */
export function CreditsPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const wb = useOptionalWorkbench();
  const list = useQuery({ queryKey: ['plans'], queryFn: api.plans.list });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CreditPlan | null>(null);

  const create = async (plan: CreditPlan) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.plans.create(plan);
      await qc.invalidateQueries({ queryKey: ['plans'] });
      nav(`/credits/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const fresh = () => create({ ...newPlan(wb?.session.instanceHost ? `${wb.session.instanceHost.split('.')[0]} estimate` : 'Untitled plan'), start: thisMonth() });

  const remove = async () => {
    if (!id) return;
    setDeleting(null);
    try {
      await api.plans.remove(id);
      qc.removeQueries({ queryKey: ['plan', id] });
      await qc.invalidateQueries({ queryKey: ['plans'] });
      nav('/credits');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="split">
      <aside>
        <div className="filters">
          <div className="row">
            <b className="grow">Credit plans</b>
            <button className="primary" onClick={() => void fresh()} disabled={busy}>New plan</button>
          </div>
        </div>
        <nav className="list" aria-label="Credit plans">
          {list.isLoading && <div className="hint">Loading…</div>}
          {list.error && <div className="alert error small" style={{ margin: 10 }}>{list.error.message}</div>}
          {list.data?.length === 0 && <div className="hint small">No plans yet.</div>}
          {list.data?.map((p) => (
            <Link key={p.id} className={`obj-item${p.id === id ? ' active' : ''}`} to={`/credits/${p.id}`}>
              <div className="name">{p.name}</div>
              <div className="meta">
                {p.client && <span>{p.client}</span>}
                <span>edited {fmtAgo(new Date(p.updatedAt).toISOString())}</span>
              </div>
            </Link>
          ))}
        </nav>
      </aside>
      <section>
        {error && <div className="alert error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
        {id ? (
          <PlanEditor
            key={id}
            id={id}
            onDuplicate={(p) => void create({ ...p, name: `${p.name} (copy)`.slice(0, 120), actuals: [] })}
            onDelete={(p) => setDeleting(p)}
          />
        ) : (
          <Intro onNew={() => void fresh()} busy={busy} connected={Boolean(wb)} />
        )}
      </section>
      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete “${deleting?.name ?? ''}”?`}
        confirmLabel="Delete plan"
        onCancel={() => setDeleting(null)}
        onConfirm={() => void remove()}
      >
        <p style={{ margin: 0 }}>The plan, its activities and any actuals entered are deleted for good. Export it first if you may need it.</p>
      </ConfirmDialog>
    </div>
  );
}

function Intro({ onNew, busy, connected }: { onNew: () => void; busy: boolean; connected: boolean }) {
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <h1>Credit plans</h1>
      <p style={{ margin: 0 }}>
        Estimate what a client’s Data 360 work will consume. List the activities (ingestion, identity resolution, insights, segment
        refreshes, activations) with their volumes and schedules, and see Flex Credits by month, how long
        the entitlement lasts and which changes would cut it. Enter actuals from Digital Wallet as the months go by to track the plan.
      </p>
      <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
        <li>
          Priced in Flex Credits with the {RATE_CARD.name} (updated {RATE_CARD.asOf}): monthly tiers per usage type, flat sandbox.
          Multipliers can be overridden for negotiated rates.
        </li>
        <li>Every activity carries its assumption, and the Excel and Markdown exports include them and the rate card used.</li>
        <li>Plans are saved to your workbench account, not to the org, and work without connecting one.</li>
        <li>{connected ? 'With this org connected, “Add from this org” proposes activities from its streams, segments and insights (no queries run).' : 'Connect an org to propose activities from its streams, segments and insights.'}</li>
      </ul>
      <div><button className="primary" onClick={onNew} disabled={busy}>New plan</button></div>
    </div>
  );
}
