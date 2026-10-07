import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { normalizeMetadata } from '../server/data360/normalize';
import { METADATA } from '../server/data360/mock/fixtures';
import {
  buildHealthReport,
  dictionaryMarkdown,
  dictionaryTables,
  reportHtml,
  reportMarkdown,
  tableToCsv,
  uniqueRelationships,
  type CachedStats,
} from '../shared/report';
import { buildXlsx, sheetName } from '../shared/xlsx';
import type { Extras, ObjectMeta } from '../shared/types';

const objects: ObjectMeta[] = [
  ...normalizeMetadata(METADATA.DataModelObject, 'dmo'),
  ...normalizeMetadata(METADATA.DataLakeObject, 'dlo'),
  ...normalizeMetadata(METADATA.CalculatedInsight, 'ci'),
];
const ctx = { host: 'acme.my.salesforce.com', dataspace: 'default', at: new Date('2026-10-07T12:00:00Z') };
const none: CachedStats = { counts: {}, profiles: {} };
const cached: CachedStats = {
  counts: { ssot__Individual__dlm: { rows: 2500, at: '2026-10-06T10:00:00Z' } },
  profiles: {
    ssot__Individual__dlm: {
      rows: 2500,
      computedAt: '2026-10-06T10:05:00Z',
      fields: {
        ssot__Id__c: { nonNull: 2500, nullRate: 0, distinct: 2500 },
        ssot__FirstName__c: { nonNull: 2375, nullRate: 0.05, distinct: 10 },
        ssot__YearlyIncome__c: { nonNull: 1000, nullRate: 0.6, distinct: 900, min: 30000, max: 150000 },
      },
    },
  },
};

describe('data dictionary', () => {
  const tables = dictionaryTables(objects, cached, ctx);
  const [about, objs, fields, rels] = tables;

  it('records the org, data space and export time, and says it holds no row data', () => {
    expect(about!.rows).toContainEqual(['Org', 'acme.my.salesforce.com']);
    expect(about!.rows).toContainEqual(['Data space', 'default']);
    expect(about!.rows).toContainEqual(['Generated', '2026-10-07T12:00:00Z']);
    expect(String(about!.rows.find((r) => r[0] === 'Note')![1])).toMatch(/no row data/);
  });

  it('covers all three kinds, with insight dimensions and measures as fields', () => {
    expect(new Set(objs!.rows.map((r) => r[2]))).toEqual(new Set(['Data model object', 'Data lake object', 'Calculated insight']));
    const ci = fields!.rows.filter((r) => r[0] === 'Avg_Spends__cio');
    expect(ci.map((r) => r[9])).toEqual(['dimension', 'dimension', 'measure']);
    expect(fields!.rows.length).toBe(objects.reduce((n, o) => n + o.fields.length, 0));
  });

  it('includes cached aggregates with their timestamps, and leaves them blank otherwise', () => {
    const ind = objs!.rows.find((r) => r[0] === 'ssot__Individual__dlm')!;
    expect(ind.slice(7)).toEqual([2500, '2026-10-06T10:00:00Z', '2026-10-06T10:05:00Z']);
    const income = fields!.rows.find((r) => r[0] === 'ssot__Individual__dlm' && r[3] === 'ssot__YearlyIncome__c')!;
    expect(income.slice(10)).toEqual([40, 900, 30000, 150000, '2026-10-06T10:05:00Z']);
    const email = fields!.rows.find((r) => r[0] === 'ssot__ContactPointEmail__dlm')!;
    expect(email.slice(10)).toEqual([null, null, null, null, null]);
    expect(fields!.rows.find((r) => r[3] === 'ssot__Id__c' && r[0] === 'ssot__Account__dlm')![7]).toBe('yes');
  });

  it('lists each relationship once even though both ends report it', () => {
    const all = objects.flatMap((o) => o.relationships).length;
    expect(rels!.rows.length).toBe(uniqueRelationships(objects).length);
    expect(rels!.rows.length).toBeLessThan(all);
    expect(rels!.rows).toContainEqual(['ssot__ContactPointEmail__dlm', 'ssot__PartyId__c', 'ssot__Individual__dlm', 'ssot__Id__c', 'NTOONE']);
  });

  it('writes CSV that neutralises formulas from org metadata', () => {
    const csv = tableToCsv({ name: 'x', title: 'x', header: ['a', 'b'], rows: [['=HYPERLINK("http://evil")', 'plain, "quoted"']] });
    expect(csv).toBe('a,b\n"\'=HYPERLINK(""http://evil"")","plain, ""quoted"""\n');
  });

  it('writes Markdown with pipes and newlines escaped', () => {
    const md = dictionaryMarkdown([about!, { name: 'f', title: 'Fields', header: ['n'], rows: [['a|b\nc']] }]);
    expect(md).toContain('# Data dictionary');
    expect(md).toContain('- **Org:** acme.my.salesforce.com');
    expect(md).toContain('| a\\|b c |');
  });

  it('writes an .xlsx workbook with one sheet per table', () => {
    const bytes = buildXlsx(tables.map((t) => ({ name: t.title, header: t.header, rows: t.rows })));
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet4.xml']));
    const wb = strFromU8(files['xl/workbook.xml']!);
    expect(wb).toContain('<sheet name="Fields" sheetId="3" r:id="rId3"/>');
    const sheet3 = strFromU8(files['xl/worksheets/sheet3.xml']!);
    expect(sheet3).toContain('<pane ySplit="1"');
    expect(sheet3).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Object</t></is></c>');
    expect(sheet3).toMatch(/<c r="K\d+"><v>40<\/v><\/c>/); // numbers stay numbers
  });

  it('escapes XML and drops characters XML cannot hold; never writes formulas', () => {
    const files = unzipSync(buildXlsx([{ name: 'a/b:c*?[x]', header: ['h'], rows: [['<b>&"x"\u0001'], ['=1+1'], [true]] }]));
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!);
    expect(sheet).toContain('&lt;b&gt;&amp;&quot;x&quot;</t>');
    expect(sheet).not.toContain('\u0001');
    expect(sheet).not.toContain('<f>');
    expect(sheet).toContain('>=1+1</t>');
    expect(sheet).toContain('>yes</t>');
    expect(strFromU8(files['xl/workbook.xml']!)).toContain('name="a b c   x"');
  });

  it('keeps sheet names within Excel rules and unique', () => {
    const taken = new Set<string>();
    expect(sheetName('x'.repeat(40), taken)).toHaveLength(31);
    expect(sheetName('x'.repeat(40), taken)).toBe(`${'x'.repeat(29)} 2`);
    expect(sheetName('', taken)).toBe('Sheet');
  });
});

describe('health report', () => {
  const extras: Extras = {
    dataStreams: {
      total: 2,
      truncated: false,
      items: [
        { name: 'Web', label: 'Web', lastRunStatus: 'SUCCESS' },
        { name: 'Orders', label: 'Orders <script>', lastRunStatus: 'FAILED', lastRefreshDate: '2026-10-03T22:30:00Z', dataLakeObject: 'Orders__dll' },
      ],
    },
    segments: { total: 1, truncated: true, items: [{ apiName: 'VIP', label: 'VIP', publishStatus: 'PUBLISH_SUCCESS', lastMemberCount: 312 }] },
    errors: [],
  };

  it('reports inventory, gaps, failed streams and completeness from cached profiles', () => {
    const r = buildHealthReport({ objects, warnings: [], extras, cached, ctx });
    const titles = r.sections.map((s) => s.title);
    expect(titles).toEqual(['Summary', 'Model inventory', 'Objects without relationships', 'Data streams', 'Segments', 'Field completeness', 'Row counts']);
    expect(r.gaps).toEqual([]);
    const streams = r.sections.find((s) => s.title === 'Data streams')!;
    expect(streams.tables!.find((t) => t.name === 'failed-streams')!.rows).toEqual([['Orders', 'Orders <script>', 'Orders__dll', '2026-10-03T22:30:00Z', null]]);
    const seg = r.sections.find((s) => s.title === 'Segments')!;
    expect(seg.paragraphs![0]).toMatch(/^1\+ segments .*Only the first 1 were read/);
    const comp = r.sections.find((s) => s.title === 'Field completeness')!;
    expect(comp.tables![0]!.rows[0]).toEqual(['ssot__Individual__dlm', 'Individual', '2026-10-06T10:05:00Z', 2500, 3, 78.3, 1]);
    expect(comp.tables![1]!.rows[0]).toEqual(['ssot__Individual__dlm', 'ssot__YearlyIncome__c', 40, 1000, 2500]);
  });

  it('says which sections were unavailable and why', () => {
    const r = buildHealthReport({
      objects, warnings: ['CalculatedInsight: HTTP 403'], extras: { dataStreams: null, segments: extras.segments, errors: ['Data streams: HTTP 500'] }, cached: none, ctx,
    });
    expect(r.gaps).toEqual([
      'Metadata partly unavailable: CalculatedInsight: HTTP 403',
      'Data streams: Data streams: HTTP 500',
      'Field completeness: no objects have been profiled in this browser',
    ]);
    expect(r.sections.find((s) => s.title === 'Data streams')!.unavailable).toBe('Data streams: HTTP 500');
    expect(r.sections.some((s) => s.title === 'Row counts')).toBe(false);
    const whole = buildHealthReport({ objects, warnings: [], extras: null, extrasError: 'network down', cached: none, ctx });
    expect(whole.gaps).toEqual(expect.arrayContaining(['Data streams: network down', 'Segments: network down']));
  });

  it('renders printable, self-contained HTML with everything escaped', () => {
    const html = reportHtml(buildHealthReport({ objects, warnings: [], extras, cached, ctx }));
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('Org <b>acme.my.salesforce.com</b> · data space <b>default</b> · generated 2026-10-07T12:00:00Z');
    expect(html).toContain('Orders &lt;script&gt;');
    expect(html).not.toMatch(/<script|<link|src=|href=/i);
    expect(html).toContain('@media print');
    expect(html).toContain('<td class="n">2,500</td>');
  });

  it('renders Markdown with the same sections', () => {
    const md = reportMarkdown(buildHealthReport({ objects, warnings: [], extras: null, extrasError: 'down', cached: none, ctx }));
    expect(md).toContain('# Data 360 org health check');
    expect(md).toContain('**Not included:**');
    expect(md).toContain('## Data streams\n\n_Unavailable: down_');
    expect(md).toContain('### Field types');
  });
});
