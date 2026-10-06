import { describe, expect, it } from 'vitest';
import { serializeLibraryFile, validateEntry } from '@shared/library';
import { parseLibraryFile } from '@shared/library-parse';

describe('library files', () => {
  it('round-trips through serialize and parse', () => {
    const entry = {
      title: 'Active "VIP" individuals',
      description: 'Contains */ and a: colon',
      tags: ['profile', 'vip'],
      dataspace: 'default',
      params: [
        { name: 'since', type: 'date' as const, label: 'Since', default: '2025-01-01' },
        { name: 'n', type: 'integer' as const },
      ],
      sql: `SELECT "ssot__Id__c" FROM "ssot__Individual__dlm" WHERE "ssot__CreatedDate__c" >= :since LIMIT :n`,
    };
    const text = serializeLibraryFile(entry);
    expect(text.split('*/').length).toBe(2); // only the header terminator
    expect(parseLibraryFile('a/b', text)).toEqual({ id: 'a/b', ...entry });
  });

  it('requires a header', () => {
    expect(() => parseLibraryFile('x', 'SELECT 1')).toThrow(/header/);
  });

  it('reports undeclared and unused params together', () => {
    const text = serializeLibraryFile({
      title: 't', description: '', tags: [], params: [{ name: 'unused', type: 'string' }], sql: 'SELECT :missing',
    });
    expect(() => parseLibraryFile('x', text)).toThrow(/:missing[\s\S]*"unused"/);
  });

  it('validates ids and param types', () => {
    const errs = validateEntry({
      id: 'Bad Id', title: 't', description: '', tags: [], sql: 'SELECT :p',
      params: [{ name: 'p', type: 'weird' as never }],
    });
    expect(errs.join('\n')).toMatch(/id "Bad Id"/);
    expect(errs.join('\n')).toMatch(/unknown type/);
  });
});
