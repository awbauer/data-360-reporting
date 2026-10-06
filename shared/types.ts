// Types shared by the server, the web app, build plugins and scripts.

export type ObjectKind = 'dmo' | 'dlo' | 'ci';

export interface FieldMeta {
  name: string;
  label: string;
  /** Data 360 metadata type, e.g. STRING, NUMBER, DATE_TIME. */
  type: string;
  businessType?: string;
  isPk: boolean;
  keyQualifier?: string;
  /** Only set for Calculated Insight fields. */
  role?: 'dimension' | 'measure';
}

export interface Relationship {
  fromEntity: string;
  toEntity: string;
  fromEntityAttribute?: string;
  toEntityAttribute?: string;
  cardinality?: string;
}

export interface ObjectMeta {
  name: string;
  label: string;
  kind: ObjectKind;
  category: string;
  fields: FieldMeta[];
  primaryKeys: string[];
  relationships: Relationship[];
}

export interface DataSpace {
  name: string;
  label: string;
  status?: string;
}

export interface QueryColumn {
  name: string;
  type: string;
  nullable?: boolean;
}

export type CellValue = string | number | boolean | null;

export interface QueryChunk {
  columns?: QueryColumn[];
  rows: CellValue[][];
}

export interface QueryResponse extends QueryChunk {
  queryId: string;
  /** True once every row is available server-side. */
  done: boolean;
  progress: number;
  rowCount: number;
  elapsedMs?: number;
}

export type ParamType = 'string' | 'integer' | 'number' | 'boolean' | 'date' | 'timestamp';

export interface ParamDef {
  name: string;
  type: ParamType;
  label?: string;
  default?: string;
}

export interface LibraryEntry {
  /** Path under queries/, without extension, e.g. "profiles/individual-counts". */
  id: string;
  title: string;
  description: string;
  tags: string[];
  dataspace?: string;
  params: ParamDef[];
  sql: string;
}

export interface ApiError {
  error: string;
  message: string;
}

export interface StreamInfo {
  name: string;
  label: string;
  status?: string;
  lastRunStatus?: string;
  lastRefreshDate?: string;
  totalRecords?: number;
}

export interface SegmentInfo {
  apiName: string;
  label: string;
  status?: string;
  publishStatus?: string;
  lastMemberCount?: number;
  lastPublished?: string;
}

/** A best-effort list: `truncated` means there were more than we fetched. */
export interface Listing<T> {
  total: number;
  truncated: boolean;
  items: T[];
}

/** Data streams and segments. Each side is null when its endpoint failed (see `errors`). */
export interface Extras {
  dataStreams: Listing<StreamInfo> | null;
  segments: Listing<SegmentInfo> | null;
  errors: string[];
}
