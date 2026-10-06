import type { FieldMeta, ObjectMeta, ParamDef, ParamType } from './types';

/** Quote a Data 360 identifier. Names are case-sensitive, so always quote. */
export function quoteIdent(name: string): string {
  if (name.length === 0) throw new Error('Empty identifier');
  return `"${name.replace(/"/g, '""')}"`;
}

const PARAM_START = /[A-Za-z_]/;
const PARAM_CHAR = /[A-Za-z0-9_]/;

/**
 * Find `:name` bind parameters, skipping `::` casts, string literals (including
 * E'' and $$ quoting), quoted identifiers and comments. Returns unique names in
 * first-use order.
 */
export function findParams(sql: string): string[] {
  const found: string[] = [];
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
    } else if (c === "'") {
      const escapes = i > 0 && /[eE]/.test(sql[i - 1]!) && !(i > 1 && PARAM_CHAR.test(sql[i - 2]!));
      i++;
      while (i < n) {
        if (escapes && sql[i] === '\\') i += 2;
        else if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") break;
        else i++;
      }
      i++;
    } else if (c === '"') {
      i++;
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') i += 2;
        else if (sql[i] === '"') break;
        else i++;
      }
      i++;
    } else if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const end = sql.indexOf(m[0], i + m[0].length);
        i = end === -1 ? n : end + m[0].length;
      } else i++;
    } else if (c === ':') {
      if (next === ':') {
        i += 2;
      } else if (next !== undefined && PARAM_START.test(next)) {
        let j = i + 2;
        while (j < n && PARAM_CHAR.test(sql[j]!)) j++;
        const name = sql.slice(i + 1, j);
        if (!found.includes(name)) found.push(name);
        i = j;
      } else i++;
    } else i++;
  }
  return found;
}

/** Connect API `sqlParameters[].type` values. */
export const API_PARAM_TYPE: Record<ParamType, string> = {
  string: 'Varchar',
  integer: 'BigInt',
  number: 'Double',
  boolean: 'Bool',
  date: 'Date',
  timestamp: 'TimestampTZ',
};

export interface SqlParameter {
  name: string;
  type: string;
  value: string;
}

function normalizeValue(def: ParamDef, raw: string): string {
  const v = raw.trim();
  switch (def.type) {
    case 'string':
      return raw;
    case 'integer':
      if (!/^[+-]?\d+$/.test(v)) throw new Error(`Parameter "${def.name}" must be an integer`);
      return String(BigInt(v));
    case 'number':
      if (v === '' || !Number.isFinite(Number(v))) throw new Error(`Parameter "${def.name}" must be a number`);
      return v;
    case 'boolean':
      if (!/^(true|false)$/i.test(v)) throw new Error(`Parameter "${def.name}" must be true or false`);
      return v.toLowerCase();
    case 'date': {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
      const d = m ? new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)) : null;
      if (!m || !d || d.getUTCMonth() !== +m[2]! - 1 || d.getUTCDate() !== +m[3]!) {
        throw new Error(`Parameter "${def.name}" must be a date (YYYY-MM-DD)`);
      }
      return v;
    }
    case 'timestamp':
      if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(v) || Number.isNaN(Date.parse(v))) {
        throw new Error(`Parameter "${def.name}" must be an ISO timestamp`);
      }
      return v;
  }
}

/**
 * Build the `sqlParameters` array for the params actually used in `sql`.
 * Missing values fall back to the def default; anything still missing throws.
 */
export function toSqlParameters(
  sql: string,
  defs: ParamDef[],
  values: Record<string, string | undefined>,
): SqlParameter[] {
  return findParams(sql).map((name) => {
    const def = defs.find((d) => d.name === name) ?? { name, type: 'string' as const };
    const raw = values[name] ?? def.default;
    if (raw === undefined || (raw === '' && def.type !== 'string')) {
      throw new Error(`Missing value for parameter "${name}"`);
    }
    return { name, type: API_PARAM_TYPE[def.type], value: normalizeValue(def, raw) };
  });
}

// ---------------------------------------------------------------- generators

export function buildPreviewSql(obj: Pick<ObjectMeta, 'name'>, limit = 100): string {
  return `SELECT * FROM ${quoteIdent(obj.name)} LIMIT ${Math.max(1, Math.floor(limit))}`;
}

export function buildRowCountSql(obj: Pick<ObjectMeta, 'name'>): string {
  return `SELECT COUNT(*) AS "rows" FROM ${quoteIdent(obj.name)}`;
}

export function buildTopValuesSql(obj: Pick<ObjectMeta, 'name'>, field: string, limit = 20): string {
  const f = quoteIdent(field);
  return (
    `SELECT ${f} AS "value", COUNT(*) AS "count" FROM ${quoteIdent(obj.name)} ` +
    `GROUP BY ${f} ORDER BY "count" DESC LIMIT ${Math.max(1, Math.floor(limit))}`
  );
}

const ORDERABLE = new Set(['NUMBER', 'DATE', 'DATE_TIME']);

export type ProfileColumnKind = 'nonNull' | 'distinct' | 'min' | 'max';

export interface ProfileBatch {
  sql: string;
  /** Layout of result columns after the leading row count. */
  layout: { field: string; kind: ProfileColumnKind }[];
}

/** One single-scan aggregate statement per batch of fields. */
export function buildProfileBatches(
  obj: Pick<ObjectMeta, 'name' | 'fields'>,
  batchSize = 60,
): ProfileBatch[] {
  const batches: ProfileBatch[] = [];
  for (let start = 0; start < Math.max(obj.fields.length, 1); start += batchSize) {
    const slice: FieldMeta[] = obj.fields.slice(start, start + batchSize);
    const exprs = [`COUNT(*) AS "rows"`];
    const layout: ProfileBatch['layout'] = [];
    slice.forEach((f, idx) => {
      const q = quoteIdent(f.name);
      const k = start + idx;
      exprs.push(`COUNT(${q}) AS "nn_${k}"`);
      layout.push({ field: f.name, kind: 'nonNull' });
      exprs.push(`APPROX_COUNT_DISTINCT(${q}) AS "nd_${k}"`);
      layout.push({ field: f.name, kind: 'distinct' });
      if (ORDERABLE.has(f.type)) {
        exprs.push(`MIN(${q}) AS "min_${k}"`);
        layout.push({ field: f.name, kind: 'min' });
        exprs.push(`MAX(${q}) AS "max_${k}"`);
        layout.push({ field: f.name, kind: 'max' });
      }
    });
    batches.push({ sql: `SELECT ${exprs.join(', ')} FROM ${quoteIdent(obj.name)}`, layout });
  }
  return batches;
}

export interface FieldProfile {
  nonNull: number;
  nullRate: number;
  distinct: number;
  min?: string | number | boolean | null;
  max?: string | number | boolean | null;
}

export interface ObjectProfile {
  rows: number;
  fields: Record<string, FieldProfile>;
  computedAt: string;
}

export function parseProfileRows(
  batches: ProfileBatch[],
  rows: (string | number | boolean | null)[][],
  now = new Date(),
): ObjectProfile {
  const first = rows[0];
  if (!first) throw new Error('Profile returned no rows');
  const total = Number(rows[0]?.[0] ?? 0);
  const fields: Record<string, FieldProfile> = {};
  batches.forEach((batch, bi) => {
    const row = rows[bi];
    if (!row) throw new Error('Profile result is missing a batch');
    batch.layout.forEach((col, ci) => {
      const value = row[ci + 1] ?? null;
      const fp = (fields[col.field] ??= { nonNull: 0, nullRate: 0, distinct: 0 });
      if (col.kind === 'nonNull') {
        fp.nonNull = Number(value ?? 0);
        fp.nullRate = total > 0 ? 1 - fp.nonNull / total : 0;
      } else if (col.kind === 'distinct') fp.distinct = Number(value ?? 0);
      else if (col.kind === 'min') fp.min = value;
      else fp.max = value;
    });
  });
  return { rows: total, fields, computedAt: now.toISOString() };
}
