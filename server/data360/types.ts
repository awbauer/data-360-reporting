import type { CellValue, DataSpace, Extras, IdentityRuleset, InsightDefinition, MappingResult, ObjectMeta, QueryChunk, QueryColumn, QueryResponse } from '../../shared/types';
import type { SqlParameter } from '../../shared/sql';

export interface SubmitQueryInput {
  sql: string;
  dataspace: string;
  params: SqlParameter[];
  rowLimit?: number;
}

export interface QueryStatus {
  queryId: string;
  done: boolean;
  progress: number;
  rowCount: number;
}

export interface MetadataResult {
  objects: ObjectMeta[];
  warnings: string[];
}

export interface PageResult extends QueryChunk {
  columns?: QueryColumn[];
  rows: CellValue[][];
}

/** The seam between the app and Data 360: real Connect API client or the mock. */
export interface Data360Client {
  listDataSpaces(): Promise<DataSpace[]>;
  getMetadata(dataspace: string): Promise<MetadataResult>;
  /** Data streams (org-wide) and segments (per data space); each side fails independently. */
  getExtras(dataspace: string): Promise<Extras>;
  /**
   * The DLO → DMO mappings into one data model object. The API requires the DMO; `dlo` only narrows
   * it. There is no way to ask "which DMOs does this DLO feed" in one call.
   */
  getMappings(dataspace: string, dmo: string, dlo?: string): Promise<MappingResult>;
  /** Identity-resolution rulesets with their profile counts. The endpoint has no data space parameter. */
  getIdentityResolutions(): Promise<IdentityRuleset[]>;
  /** The single-insight endpoint takes no data space parameter. */
  getCalculatedInsight(name: string): Promise<InsightDefinition>;
  submitQuery(input: SubmitQueryInput): Promise<QueryResponse>;
  getStatus(queryId: string, dataspace: string, waitMs: number): Promise<QueryStatus>;
  getRows(queryId: string, dataspace: string, offset: number, limit: number): Promise<PageResult>;
  cancel(queryId: string, dataspace: string): Promise<void>;
}

/** An error response from Salesforce / Data 360, already reduced to a message. */
export class UpstreamError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
