/**
 * Cheap, dependency-free heuristics about a query's cost, used to ask before running something
 * that scans a whole object. It reads text only (no parser), so it errs toward warning once in a
 * while rather than missing the common mistakes.
 */

export interface Scan {
  /** The SQL with comments, string literals and quoted identifiers blanked out. */
  masked: string;
  /** Quoted identifiers, unescaped, in order of appearance. */
  idents: string[];
}

export function scanSql(sql: string): Scan {
  const n = sql.length;
  const out: string[] = [];
  const idents: string[] = [];
  let i = 0;
  const blank = (from: number, to: number) => out.push(sql.slice(from, to).replace(/[^\n]/g, ' '));
  while (i < n) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      blank(i, stop);
      i = stop;
    } else if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === "'") {
      const escapes = i > 0 && /[eE]/.test(sql[i - 1]!);
      let j = i + 1;
      while (j < n) {
        if (escapes && sql[j] === '\\') j += 2;
        else if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      blank(i, Math.min(j + 1, n));
      i = j + 1;
    } else if (c === '"') {
      let j = i + 1;
      let name = '';
      while (j < n) {
        if (sql[j] === '"' && sql[j + 1] === '"') {
          name += '"';
          j += 2;
        } else if (sql[j] === '"') break;
        else name += sql[j++];
      }
      idents.push(name);
      blank(i, Math.min(j + 1, n));
      i = j + 1;
    } else {
      out.push(c);
      i++;
    }
  }
  return { masked: out.join(''), idents };
}

export interface QueryShape {
  isSelect: boolean;
  hasLimit: boolean;
  selectStar: boolean;
  /** Aggregates, GROUP BY or DISTINCT: result size isn't the table size. */
  summarises: boolean;
  /** Reads rows without any bound on how many come back. */
  unbounded: boolean;
  idents: string[];
}

const AGG = /\b(count|sum|avg|min|max|approx_count_distinct|stddev\w*|var\w*|string_agg|array_agg|percentile_\w+)\s*\(/i;

export function analyzeQuery(sql: string): QueryShape {
  const { masked, idents } = scanSql(sql);
  const isSelect = /^\s*(select|with)\b/i.test(masked);
  const hasLimit = /\blimit\s+(\d+|:\w+)\b/i.test(masked) || /\bfetch\s+(first|next)\b/i.test(masked);
  const selectStar = /(^|[\s,(])(\w+\.)?\*\s*(,|\bfrom\b)/i.test(masked);
  const summarises = AGG.test(masked) || /\bgroup\s+by\b/i.test(masked) || /\bselect\s+distinct\b/i.test(masked);
  return { isSelect, hasLimit, selectStar, summarises, unbounded: isSelect && !hasLimit && !summarises, idents };
}

/** Append a LIMIT to a query that has none, without breaking a trailing semicolon or comment. */
export function withLimit(sql: string, n: number): string {
  // A newline keeps the LIMIT out of a trailing `--` comment.
  return `${sql.replace(/[\s;]+$/, '')}\nLIMIT ${Math.max(1, Math.floor(n))}`;
}
