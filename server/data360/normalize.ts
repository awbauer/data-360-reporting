import type {
  CellValue,
  DataSpace,
  FieldMeta,
  ObjectKind,
  ObjectMeta,
  QueryColumn,
  QueryResponse,
  Relationship,
  SegmentInfo,
  StreamInfo,
} from '../../shared/types';
import type { PageResult, QueryStatus } from './types';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

export function kindFromName(name: string): ObjectKind {
  if (name.endsWith('__cio')) return 'ci';
  if (name.endsWith('__dll')) return 'dlo';
  return 'dmo';
}

export function normalizeDataSpaces(body: unknown): DataSpace[] {
  return arr(obj(body).dataSpaces).map((d) => {
    const o = obj(d);
    return { name: str(o.name), label: str(o.label, str(o.name)), ...(o.status ? { status: str(o.status) } : {}) };
  });
}

function normalizeRelationship(r: unknown): Relationship {
  const o = obj(r);
  return {
    fromEntity: str(o.fromEntity),
    toEntity: str(o.toEntity),
    ...(o.fromEntityAttribute ? { fromEntityAttribute: str(o.fromEntityAttribute) } : {}),
    ...(o.toEntityAttribute ? { toEntityAttribute: str(o.toEntityAttribute) } : {}),
    ...(o.cardinality ? { cardinality: str(o.cardinality) } : {}),
  };
}

/**
 * `GET /ssot/metadata`. DMO/DLO entries carry `fields`; Calculated Insights
 * carry `dimensions` and `measures` instead. `kindHint` comes from the
 * `entityType` the request asked for and wins over the name suffix.
 */
export function normalizeMetadata(body: unknown, kindHint?: ObjectKind): ObjectMeta[] {
  return arr(obj(body).metadata).map((entry): ObjectMeta => {
    const e = obj(entry);
    const name = str(e.name);
    const pkNames = arr(e.primaryKeys).map((p) => str(obj(p).name));
    const toField = (f: unknown, role?: FieldMeta['role']): FieldMeta => {
      const o = obj(f);
      const fname = str(o.name);
      return {
        name: fname,
        label: str(o.displayName, fname),
        type: str(o.type, 'UNKNOWN'),
        ...(o.businessType ? { businessType: str(o.businessType) } : {}),
        isPk: pkNames.includes(fname),
        ...(o.keyQualifier ? { keyQualifier: str(o.keyQualifier) } : {}),
        ...(role ? { role } : {}),
      };
    };
    const fields = [
      ...arr(e.fields).map((f) => toField(f)),
      ...arr(e.dimensions).map((f) => toField(f, 'dimension')),
      ...arr(e.measures).map((f) => toField(f, 'measure')),
    ];
    const kind = kindHint ?? kindFromName(name);
    return {
      name,
      label: str(e.displayName, name),
      kind,
      category: str(e.category, kind === 'ci' ? 'CalculatedInsight' : 'Unknown'),
      fields,
      primaryKeys: pkNames,
      relationships: arr(e.relationships).map(normalizeRelationship),
    };
  });
}

/** Rows are documented as `{row: [...]}` but every example shows bare arrays. */
function normalizeRows(data: unknown): CellValue[][] {
  return arr(data).map((r) => (Array.isArray(r) ? r : arr(obj(r).row)) as CellValue[]);
}

function normalizeColumns(metadata: unknown): QueryColumn[] | undefined {
  const m = arr(metadata);
  if (!m.length) return undefined;
  return m.map((c) => {
    const o = obj(c);
    return { name: str(o.name), type: str(o.type, 'Unspecified'), ...(typeof o.nullable === 'boolean' ? { nullable: o.nullable } : {}) };
  });
}

const DONE = new Set(['Finished', 'ResultsProduced']);

function normalizeStatusObject(s: Json, fallbackRows: number): QueryStatus {
  const completion = str(s.completionStatus);
  const progress = typeof s.progress === 'number' ? s.progress : DONE.has(completion) ? 1 : 0;
  return {
    queryId: str(s.queryId),
    done: DONE.has(completion) || progress >= 1,
    progress,
    rowCount: typeof s.rowCount === 'number' ? s.rowCount : fallbackRows,
  };
}

export function normalizeStatus(body: unknown): QueryStatus {
  return normalizeStatusObject(obj(body), 0);
}

export function normalizeSubmit(body: unknown): QueryResponse {
  const b = obj(body);
  const rows = normalizeRows(b.data);
  const returned = typeof b.returnedRows === 'number' ? b.returnedRows : rows.length;
  const status = normalizeStatusObject(obj(b.status), returned);
  return { ...status, columns: normalizeColumns(b.metadata), rows };
}

export function normalizePage(body: unknown): PageResult {
  const b = obj(body);
  return { columns: normalizeColumns(b.metadata), rows: normalizeRows(b.data) };
}

const optStr = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const optNum = (v: unknown) => (typeof v === 'number' ? v : undefined);

/** `GET /ssot/data-streams` page: `{dataStreams: [...], totalSize}`. */
export function normalizeStreams(body: unknown): { items: StreamInfo[]; totalSize?: number } {
  const b = obj(body);
  return {
    totalSize: optNum(b.totalSize),
    items: arr(b.dataStreams).map((d): StreamInfo => {
      const o = obj(d);
      const name = str(o.name);
      return {
        name,
        label: str(o.label, name),
        ...(optStr(o.status) ? { status: str(o.status) } : {}),
        ...(optStr(o.lastRunStatus) ? { lastRunStatus: str(o.lastRunStatus) } : {}),
        ...(optStr(o.lastRefreshDate) ? { lastRefreshDate: str(o.lastRefreshDate) } : {}),
        ...(optNum(o.totalRecords) !== undefined ? { totalRecords: optNum(o.totalRecords) } : {}),
      };
    }),
  };
}

/** `GET /ssot/segments` page: `{segments: [...]}` with no total. */
export function normalizeSegments(body: unknown): SegmentInfo[] {
  return arr(obj(body).segments).map((d): SegmentInfo => {
    const o = obj(d);
    const apiName = str(o.apiName, str(o.developerName));
    return {
      apiName,
      label: str(o.displayName, apiName),
      ...(optStr(o.segmentStatus) ? { status: str(o.segmentStatus) } : {}),
      ...(optStr(o.publishStatus) ? { publishStatus: str(o.publishStatus) } : {}),
      ...(optNum(o.lastSegmentMemberCount) !== undefined ? { lastMemberCount: optNum(o.lastSegmentMemberCount) } : {}),
      ...(optStr(o.lastPublishedEndDateTime) ? { lastPublished: str(o.lastPublishedEndDateTime) } : {}),
    };
  });
}
