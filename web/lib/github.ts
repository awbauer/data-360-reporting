import { serializeLibraryFile, validateEntry } from '@shared/library';
import type { LibraryEntry } from '@shared/types';

export const LIBRARY_REPO = import.meta.env.VITE_LIBRARY_REPO ?? 'awbauer/data-360-reporting';
export const LIBRARY_BRANCH = import.meta.env.VITE_LIBRARY_BRANCH ?? 'main';

/** GitHub truncates very long query strings; beyond this we fall back to copy/paste. */
const MAX_URL = 7500;

export const editUrl = (id: string) => `https://github.com/${LIBRARY_REPO}/edit/${LIBRARY_BRANCH}/queries/${id}.sql`;

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'query';
}

export interface Proposal {
  id: string;
  text: string;
  errors: string[];
  /** Pre-filled "new file" URL, or null when the file is too large to pass in the URL. */
  url: string | null;
  /** Fallback that opens an empty new-file form for the same path. */
  blankUrl: string;
}

export function buildProposal(folder: string, entry: Omit<LibraryEntry, 'id'>): Proposal {
  const dir = folder.trim().replace(/^\/+|\/+$/g, '');
  const id = `${dir ? `${dir}/` : ''}${slugify(entry.title)}`;
  const text = serializeLibraryFile(entry);
  const errors = validateEntry({ ...entry, id });
  const filename = `queries/${id}.sql`;
  const base = `https://github.com/${LIBRARY_REPO}/new/${LIBRARY_BRANCH}?filename=${encodeURIComponent(filename)}`;
  const url = `${base}&value=${encodeURIComponent(text)}`;
  return { id, text, errors, url: url.length <= MAX_URL ? url : null, blankUrl: base };
}
