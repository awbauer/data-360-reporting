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
