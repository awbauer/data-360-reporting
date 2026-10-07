// localStorage can throw or be empty (private windows, blocked storage); every
// access is wrapped so the app works without it.

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or blocked storage: ignore */
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------ typed caches

import type { ObjectProfile } from '@shared/sql';
import type { ParamDef } from '@shared/types';

export interface CachedCount {
  rows: number;
  at: string;
}

const cacheKey = (kind: string, host: string, dataspace: string, object: string) =>
  `d360:${kind}:${host}:${dataspace}:${object}`;

// Row counts feed cost estimates elsewhere, so changes are announced (useSyncExternalStore reads these).
let countsVersion = 0;
const countListeners = new Set<() => void>();
const countsChanged = () => {
  countsVersion++;
  countListeners.forEach((f) => f());
};
export const subscribeCounts = (f: () => void): (() => void) => {
  countListeners.add(f);
  return () => void countListeners.delete(f);
};
export const getCountsVersion = (): number => countsVersion;

export const countCache = {
  get: (host: string, ds: string, obj: string) => readJson<CachedCount | null>(cacheKey('count', host, ds, obj), null),
  set(host: string, ds: string, obj: string, v: CachedCount) {
    writeJson(cacheKey('count', host, ds, obj), v);
    countsChanged();
  },
};

export const profileCache = {
  get: (host: string, ds: string, obj: string) => readJson<ObjectProfile | null>(cacheKey('profile', host, ds, obj), null),
  set(host: string, ds: string, obj: string, v: ObjectProfile) {
    writeJson(cacheKey('profile', host, ds, obj), v);
    countsChanged();
  },
};

/** Rows we know an object has: a fresh count, else the row total from its last profile. */
export function knownRows(host: string, ds: string, obj: string): number | undefined {
  return countCache.get(host, ds, obj)?.rows ?? profileCache.get(host, ds, obj)?.rows;
}

export interface Draft {
  sql: string;
  dataspace?: string;
  paramDefs: ParamDef[];
  params: Record<string, string>;
}

export const draft = {
  get: () => readJson<Draft | null>('d360:draft', null),
  set: (d: Draft) => writeJson('d360:draft', d),
};

/**
 * History and saved credentials used to live in localStorage; both are now kept per user on the
 * server. Remove the old copies so they don't linger in a shared browser.
 */
export function forgetLegacyData(): void {
  removeKey('d360:history');
  removeKey('d360:creds');
}

export interface TabData {
  id: string;
  /** Stable number used to name untitled tabs. */
  n: number;
  sql: string;
  paramDefs: ParamDef[];
  values: Record<string, string>;
}

export interface TabStore {
  tabs: TabData[];
  active: string;
}

export const MAX_TABS = 10;

export function emptyTab(existing: TabData[], init: Partial<TabData> = {}): TabData {
  return {
    id: crypto.randomUUID(),
    n: existing.reduce((m, t) => Math.max(m, t.n), 0) + 1,
    sql: '',
    paramDefs: [],
    values: {},
    ...init,
  };
}

export function normalizeTabs(saved: TabStore | null | undefined): TabStore | null {
  if (!saved?.tabs?.length) return null;
  const tabs = saved.tabs.slice(0, MAX_TABS);
  return { tabs, active: tabs.some((t) => t.id === saved.active) ? saved.active : tabs[0]!.id };
}

/**
 * The browser's copy of a user's tabs. The server copy (/api/state/tabs) wins when it exists;
 * this one covers the moment before it loads, or a server that can't be reached.
 */
export const tabStore = {
  load(user: string): TabStore {
    // Older builds kept one unscoped set of tabs, and before that a single draft.
    const saved = normalizeTabs(readJson<TabStore | null>(`d360:tabs:${user}`, null) ?? readJson<TabStore | null>('d360:tabs', null));
    if (saved) return saved;
    const old = draft.get();
    const first = emptyTab([], old ? { sql: old.sql, paramDefs: old.paramDefs, values: old.params } : {});
    return { tabs: [first], active: first.id };
  },
  save(user: string, s: TabStore) {
    writeJson(`d360:tabs:${user}`, s);
    removeKey('d360:tabs');
    removeKey('d360:draft');
  },
};

/** "Ask before running a query with no LIMIT" can be silenced for the rest of the browser session. */
export const skipLimitWarning = {
  get(): boolean {
    try {
      return sessionStorage.getItem('d360:skip-limit-warning') === '1';
    } catch {
      return false;
    }
  },
  set(on: boolean) {
    try {
      if (on) sessionStorage.setItem('d360:skip-limit-warning', '1');
      else sessionStorage.removeItem('d360:skip-limit-warning');
    } catch {
      /* ignore */
    }
  },
};
