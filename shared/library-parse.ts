import { parse } from 'yaml';
import { coerceParams, validateEntry } from './library';
import type { LibraryEntry } from './types';

const HEADER_RE = /^\s*\/\*---\s*\n([\s\S]*?)\n\s*---\*\/\s*\n?([\s\S]*)$/;

/** Parse a library file. Throws an Error listing every problem found. */
export function parseLibraryFile(id: string, text: string): LibraryEntry {
  const m = HEADER_RE.exec(text.replace(/\r\n/g, '\n'));
  if (!m) throw new Error(`${id}: missing "/*--- … ---*/" header`);
  let header: unknown;
  try {
    header = parse(m[1]!.replace(/\*\\\//g, '*/'));
  } catch (e) {
    throw new Error(`${id}: header is not valid YAML (${(e as Error).message})`);
  }
  if (typeof header !== 'object' || header === null || Array.isArray(header)) {
    throw new Error(`${id}: header must be a mapping`);
  }
  const h = header as Record<string, unknown>;
  let entry: LibraryEntry;
  try {
    entry = {
      id,
      title: String(h.title ?? ''),
      description: h.description === undefined ? '' : String(h.description),
      tags: Array.isArray(h.tags) ? h.tags.map(String) : [],
      ...(h.dataspace !== undefined ? { dataspace: String(h.dataspace) } : {}),
      params: coerceParams(h.params),
      sql: m[2]!.trim(),
    };
  } catch (e) {
    throw new Error(`${id}: ${(e as Error).message}`);
  }
  const errors = validateEntry(entry);
  if (errors.length) throw new Error(`${id}:\n  - ${errors.join('\n  - ')}`);
  return entry;
}
