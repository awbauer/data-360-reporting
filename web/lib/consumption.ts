import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import {
  dailySql,
  entitlementSql,
  findSources,
  isoDay,
  monthlySql,
  parseDaily,
  parseEntitlement,
  parseMonthly,
  parseResources,
  pickSources,
  resourcesSql,
  type Consumption,
} from '@shared/consumption';
import { creditsFor } from '@shared/estimate';
import type { ParamDef } from '@shared/types';
import { runToCompletion } from '../api';
import { useWorkbench } from '../context';
import { knownRows, readJson, writeJson } from './storage';

// Actual consumption read from the org, cached per org and data space like row counts are.
const cacheKey = (host: string, ds: string) => `d360:consumption:${host}:${ds}`;
const CHANGED = 'd360:consumption-changed';
let version = 0;
const bump = () => {
  version++;
  window.dispatchEvent(new Event(CHANGED));
};
const subscribe = (cb: () => void) => {
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith('d360:consumption:')) {
      version++;
      cb();
    }
  };
  window.addEventListener(CHANGED, cb);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGED, cb);
    window.removeEventListener('storage', onStorage);
  };
};
const getVersion = () => version;

const DAY = 86_400_000;
const SINCE: ParamDef[] = [{ name: 'since', type: 'date' }];

/**
 * The org's consumption feeds in this data space, what was last read from them, and a way to read
 * them again. Reading runs a few small queries (they're billed like any other); nothing runs until
 * `load` is called.
 */
export function useConsumption() {
  const wb = useWorkbench();
  const host = wb.session.instanceHost ?? '';
  const ds = wb.dataspace;
  const v = useSyncExternalStore(subscribe, getVersion);
  const sources = useMemo(() => findSources(wb.objects), [wb.objects]);
  const pick = useMemo(() => pickSources(sources), [sources]);
  // `v` changes whenever any tab or component caches new consumption.
  const data = useMemo(() => readJson<Consumption | null>(cacheKey(host, ds), null), [host, ds, v]);
  const [progress, setProgress] = useState<string | null>(null);

  const reads = [pick.totals, pick.totals, pick.resources, pick.entitlement].filter(Boolean);
  const known = reads.map((s) => knownRows(host, ds, s!.object.name));
  const scan = known.every((r) => r !== undefined) ? known.reduce<number>((t, r) => t + r!, 0) : null;

  const load = useCallback(async () => {
    const now = Date.now();
    const d = new Date(now);
    const monthlySince = isoDay(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 12, 1));
    const dailySince = isoDay(now - 90 * DAY);
    const resourcesSince = isoDay(now - 30 * DAY);
    const errors: string[] = [];
    const run = async <T,>(label: string, sql: string, since: string | null, parse: (cols: { name: string }[], rows: import('@shared/types').CellValue[][]) => T[]): Promise<T[]> => {
      setProgress(`Reading ${label}…`);
      try {
        const r = await runToCompletion(
          { sql, dataspace: ds, source: 'credits', ...(since ? { paramDefs: SINCE, params: { since } } : {}) },
          { maxRows: 20_000 },
        );
        return parse(r.columns, r.rows);
      } catch (e) {
        errors.push(`${label}: ${(e as Error).message}`);
        return [];
      }
    };
    try {
      const out: Consumption = {
        at: new Date(now).toISOString(),
        sources: {
          ...(pick.totals ? { totals: pick.totals.object.name } : {}),
          ...(pick.resources ? { resources: pick.resources.object.name } : {}),
          ...(pick.entitlement ? { entitlement: pick.entitlement.object.name } : {}),
        },
        monthlySince,
        dailySince,
        resourcesSince,
        monthly: pick.totals ? await run('credits by month', monthlySql(pick.totals, monthlySince).sql, monthlySince, parseMonthly) : [],
        daily: pick.totals ? await run('credits by day', dailySql(pick.totals, dailySince).sql, dailySince, parseDaily) : [],
        resources: pick.resources ? await run('credits by resource', resourcesSql(pick.resources, resourcesSince).sql, resourcesSince, parseResources) : [],
        entitlement: pick.entitlement ? await run('credits purchased', entitlementSql(pick.entitlement).sql, null, parseEntitlement) : [],
        ...(errors.length ? { errors } : {}),
      };
      writeJson(cacheKey(host, ds), out);
      bump();
    } finally {
      setProgress(null);
    }
  }, [pick, host, ds]);

  return { sources, pick, data, load, progress, queries: reads.length, scanCredits: scan === null ? null : creditsFor(scan) };
}

/** What was last read, for pages that show actuals beside estimates; null when nothing was. */
export function useCachedConsumption(): Consumption | null {
  const wb = useWorkbench();
  const v = useSyncExternalStore(subscribe, getVersion);
  const host = wb.session.instanceHost ?? '';
  return useMemo(() => readJson<Consumption | null>(cacheKey(host, wb.dataspace), null), [host, wb.dataspace, v]);
}
