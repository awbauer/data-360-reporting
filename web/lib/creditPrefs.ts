import { useCallback, useSyncExternalStore } from 'react';
import { RATE_CARDS, type RateCard, type RateCardId } from '@shared/credits';
import { readJson, writeJson } from './storage';

// Which rate card inline estimates use, per browser. Every card on the page follows a change.
const KEY = 'd360:credit-card';
const CHANGED = 'd360:credit-card-changed';
const DEFAULT: RateCardId = 'flex-2026-06';

const read = (): RateCardId => {
  const v = readJson<string>(KEY, DEFAULT);
  return v in RATE_CARDS ? (v as RateCardId) : DEFAULT;
};

const subscribe = (cb: () => void) => {
  window.addEventListener(CHANGED, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(CHANGED, cb);
    window.removeEventListener('storage', cb);
  };
};

export function useRateCard(): [RateCard, (id: RateCardId) => void] {
  const id = useSyncExternalStore(subscribe, read, () => DEFAULT);
  const set = useCallback((next: RateCardId) => {
    writeJson(KEY, next);
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  return [RATE_CARDS[id], set];
}
