import { useEffect, useState } from 'react';
import { parseQuantity } from '@shared/credits';
import { fmtNum } from '../lib/format';

const show = (v: number | undefined) => (v === undefined ? '' : fmtNum(Math.round(v * 100) / 100));

/**
 * A number field that accepts shorthand (5m, 2.5k, 1,200,000) and shows separators. Commits on
 * blur or Enter; text it can't read stays, marked invalid, until it's fixed.
 */
export function QuantityInput({ value, onChange, optional, label, placeholder, className = 'q' }: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  /** Empty means "not set" rather than 0. */
  optional?: boolean;
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState(show(value));
  const [focused, setFocused] = useState(false);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (!focused && !bad) setText(show(value));
  }, [value, focused, bad]);

  const commit = () => {
    const t = text.trim();
    if (!t && optional) {
      setBad(false);
      if (value !== undefined) onChange(undefined);
      return;
    }
    const v = parseQuantity(t || '0');
    if (v === null) return setBad(true);
    setBad(false);
    if (v !== value) onChange(v);
    setText(show(v));
  };

  return (
    <input
      className={className}
      inputMode="decimal"
      aria-label={label}
      aria-invalid={bad || undefined}
      title={bad ? 'Enter a number, e.g. 2,500,000 or 2.5m' : undefined}
      value={text}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
