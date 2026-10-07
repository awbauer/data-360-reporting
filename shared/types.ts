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
  /** The data lake object this stream loads, when the API says. */
  dataLakeObject?: string;
  /** Below: best-effort, from the spec; used to seed credit estimates. */
  connectorType?: string;
  /** e.g. FULL_REFRESH, UPSERT. */
  refreshMode?: string;
  /** e.g. HOURLY, DAILY. */
  refreshFrequency?: string;
  /** Rows the last run processed. */
  lastRunRecords?: number;
}

export interface SegmentInfo {
  apiName: string;
  label: string;
  status?: string;
  publishStatus?: string;
  lastMemberCount?: number;
  lastPublished?: string;
  nextPublish?: string;
  publishInterval?: string;
  description?: string;
  /** The object the segment is built on (usually Unified Individual). */
  segmentOn?: string;
  segmentType?: string;
  /** Read-only rule text as the API returns it (often escaped JSON). */
  includeCriteria?: string;
  excludeCriteria?: string;
}

/** One DLO → DMO mapping and its field pairs (`/ssot/data-model-object-mappings`). */
export interface ObjectMapping {
  name: string;
  status?: string;
  /** Source data lake object. */
  source: string;
  /** Target data model object. */
  target: string;
  fields: { source: string; target: string }[];
}

export interface MappingResult {
  mappings: ObjectMapping[];
  /** The upstream response, kept so the shape can be checked against a real org. */
  raw: unknown;
}

export interface InsightField {
  name: string;
  label: string;
  /** How the field is computed, e.g. `COUNT(ssot__Case__dlm.ssot__Id__c)`. */
  formula?: string;
  dataType?: string;
}

/** `/ssot/calculated-insights/{apiName}`. Everything but the name is best-effort. */
export interface InsightDefinition {
  name: string;
  label: string;
  description?: string;
  expression?: string;
  status?: string;
  /** e.g. IN_USE. */
  definitionStatus?: string;
  enabled?: boolean;
  lastRunStatus?: string;
  lastRunAt?: string;
  lastRunError?: string;
  definitionType?: string;
  /** e.g. NOT_SCHEDULED. */
  schedule?: string;
  dimensions: InsightField[];
  measures: InsightField[];
  raw: unknown;
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
