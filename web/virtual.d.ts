declare module 'virtual:query-library' {
  import type { LibraryEntry } from '@shared/types';
  const entries: LibraryEntry[];
  export default entries;
}

interface ImportMetaEnv {
  readonly VITE_LIBRARY_REPO?: string;
  readonly VITE_LIBRARY_BRANCH?: string;
}
