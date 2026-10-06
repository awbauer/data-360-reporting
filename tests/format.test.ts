import { describe, expect, it } from 'vitest';
import { formatSql } from '../web/lib/formatSql';
import { findParams } from '@shared/sql';

describe('formatSql', () => {
  it('formats and keeps bind parameters, quoted names and casts intact', async () => {
    const sql = `select "a"."ssot__Id__c" as "id", count(*) from "ssot__Individual__dlm" a join "B" b on a."x"=b."y" where a."d" >= :since and a."n"::int > :n group by 1 order by 2 desc limit 10`;
    const out = await formatSql(sql);
    expect(out).toContain('\n');
    expect(out).toMatch(/SELECT/);
    expect(findParams(out)).toEqual(['since', 'n']);
    expect(out).toContain('"ssot__Individual__dlm"');
    expect(out).toContain('::int');
  });

  it('keeps comments and string literals', async () => {
    const out = await formatSql(`-- note :notaparam\nselect 'it''s :nope' as s from "T" -- tail`);
    expect(out).toContain("'it''s :nope'");
    expect(findParams(out)).toEqual([]);
    expect(out).toContain('-- note :notaparam');
  });
});
