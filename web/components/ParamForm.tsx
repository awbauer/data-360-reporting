import { PARAM_TYPES } from '@shared/library';
import type { ParamDef, ParamType } from '@shared/types';

interface Props {
  names: string[];
  defs: Record<string, ParamDef>;
  values: Record<string, string>;
  onDef: (name: string, type: ParamType) => void;
  onValue: (name: string, value: string) => void;
}

/** One input per `:param` found in the SQL. */
export function ParamForm({ names, defs, values, onDef, onValue }: Props) {
  if (!names.length) return null;
  return (
    <div className="params" aria-label="Query parameters">
      {names.map((n) => {
        const type = defs[n]?.type ?? 'string';
        const v = values[n] ?? '';
        return (
          <div className="p" key={n}>
            <span>
              <code>:{n}</code>
              {defs[n]?.label ? ` · ${defs[n]!.label}` : ''}
            </span>
            <div className="inputs">
              <select value={type} onChange={(e) => onDef(n, e.target.value as ParamType)} aria-label={`${n} type`}>
                {PARAM_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
              {type === 'boolean' ? (
                <select value={v} onChange={(e) => onValue(n, e.target.value)} aria-label={`${n} value`}>
                  <option value="">–</option>
                  <option>true</option>
                  <option>false</option>
                </select>
              ) : (
                <input
                  aria-label={`${n} value`}
                  type={type === 'date' ? 'date' : type === 'timestamp' ? 'datetime-local' : 'text'}
                  inputMode={type === 'integer' || type === 'number' ? 'decimal' : undefined}
                  value={v}
                  onChange={(e) => onValue(n, e.target.value)}
                  placeholder={type}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
