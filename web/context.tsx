import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DataSpace, ObjectMeta } from '@shared/types';
import { api, type SessionInfo } from './api';
import { readJson, writeJson } from './lib/storage';

interface Workbench {
  session: SessionInfo;
  dataspace: string;
  setDataspace: (d: string) => void;
  dataspaces: DataSpace[];
  objects: ObjectMeta[];
  byName: Map<string, ObjectMeta>;
  warnings: string[];
  metaLoading: boolean;
  metaError: Error | null;
  reloadMetadata: () => void;
}

const Ctx = createContext<Workbench | null>(null);

/** The workbench when an org is connected; null on pages that also work without one. */
export function useOptionalWorkbench(): Workbench | null {
  return useContext(Ctx);
}

export function useWorkbench(): Workbench {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkbench outside provider');
  return v;
}

export function WorkbenchProvider({ session, children }: { session: SessionInfo; children: ReactNode }) {
  const qc = useQueryClient();
  const [dataspace, setDs] = useState(() => readJson<string>('d360:dataspace', 'default'));
  const spaces = useQuery({ queryKey: ['dataspaces'], queryFn: api.dataspaces });
  const dataspaces = useMemo(() => spaces.data ?? [{ name: 'default', label: 'default' }], [spaces.data]);

  // Fall back if the remembered data space isn't available to this user.
  useEffect(() => {
    if (spaces.data && spaces.data.length && !spaces.data.some((d) => d.name === dataspace)) {
      setDs(spaces.data.find((d) => d.name === 'default')?.name ?? spaces.data[0]!.name);
    }
  }, [spaces.data, dataspace]);

  const setDataspace = useCallback((d: string) => {
    setDs(d);
    writeJson('d360:dataspace', d);
  }, []);

  const meta = useQuery({
    queryKey: ['metadata', session.instanceHost, dataspace],
    queryFn: () => api.metadata(dataspace),
    staleTime: 15 * 60_000,
  });

  const objects = useMemo(() => meta.data?.objects ?? [], [meta.data]);
  const byName = useMemo(() => new Map(objects.map((o) => [o.name, o])), [objects]);

  const value: Workbench = {
    session,
    dataspace,
    setDataspace,
    dataspaces,
    objects,
    byName,
    warnings: meta.data?.warnings ?? [],
    metaLoading: meta.isLoading,
    metaError: meta.error,
    reloadMetadata: () => void qc.invalidateQueries({ queryKey: ['metadata'] }),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
