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

export const countCache = {
  get: (host: string, ds: string, obj: string) => readJson<CachedCount | null>(cacheKey('count', host, ds, obj), null),
  set: (host: string, ds: string, obj: string, v: CachedCount) => writeJson(cacheKey('count', host, ds, obj), v),
};

export const profileCache = {
  get: (host: string, ds: string, obj: string) => readJson<ObjectProfile | null>(cacheKey('profile', host, ds, obj), null),
  set: (host: string, ds: string, obj: string, v: ObjectProfile) => writeJson(cacheKey('profile', host, ds, obj), v),
};

export interface HistoryItem {
  id: string;
  at: string;
  sql: string;
  dataspace: string;
  paramDefs: ParamDef[];
  params: Record<string, string>;
  rows: number;
  elapsedMs: number;
}

const HISTORY_KEY = 'd360:history';
const HISTORY_MAX = 50;

export const history = {
  list: () => readJson<HistoryItem[]>(HISTORY_KEY, []),
  add(item: HistoryItem) {
    const rest = history.list().filter((h) => !(h.sql === item.sql && h.dataspace === item.dataspace));
    writeJson(HISTORY_KEY, [item, ...rest].slice(0, HISTORY_MAX));
  },
  clear: () => removeKey(HISTORY_KEY),
};

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

/** A consumer key/secret the user chose to keep. `saved` is opaque ciphertext made by the server. */
export interface SavedCredentials {
  clientId: string;
  saved: string;
}

export const savedCredentials = {
  get: () => readJson<SavedCredentials | null>('d360:creds', null),
  set: (v: SavedCredentials) => writeJson('d360:creds', v),
  clear: () => removeKey('d360:creds'),
};

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

export const tabStore = {
  load(): TabStore {
    const saved = readJson<TabStore | null>('d360:tabs', null);
    if (saved?.tabs?.length) {
      return { tabs: saved.tabs, active: saved.tabs.some((t) => t.id === saved.active) ? saved.active : saved.tabs[0]!.id };
    }
    // Before tabs existed there was a single draft.
    const old = draft.get();
    const first = emptyTab([], old ? { sql: old.sql, paramDefs: old.paramDefs, values: old.params } : {});
    return { tabs: [first], active: first.id };
  },
  save: (s: TabStore) => writeJson('d360:tabs', s),
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
