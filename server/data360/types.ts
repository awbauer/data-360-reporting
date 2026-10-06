import type { CellValue, DataSpace, ObjectMeta, QueryChunk, QueryColumn, QueryResponse } from '../../shared/types';
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
