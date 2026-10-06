import { findParams } from '@shared/sql';
import { scanSql } from '@shared/sqlcheck';

/**
 * Pretty-print SQL. The formatter is loaded on demand (it is only needed when asked for), and the
 * result is checked against the input: if the bind parameters or quoted names differ, we refuse
 * rather than hand back a query that means something else.
 */
export async function formatSql(sql: string): Promise<string> {
  const { format } = await import('sql-formatter');
  const out = format(sql, {
    language: 'postgresql',
    keywordCase: 'upper',
    tabWidth: 2,
    linesBetweenQueries: 1,
    paramTypes: { named: [':'] },
  });
  const same = <T,>(a: T[], b: T[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  if (!same(findParams(sql), findParams(out)) || !same(scanSql(sql).idents, scanSql(out).idents)) {
    throw new Error('Could not format this query safely, so it was left as it is.');
  }
  return out.trimEnd();
}
