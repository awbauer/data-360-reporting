-- What the workbench estimated a run would read, from row counts the browser had cached. An
-- ESTIMATE of rows scanned, never a measurement: Salesforce's API reports no credit figures.
-- Null means the browser had nothing to estimate from (for instance an object never counted).
alter table "query_log" add column "est_rows" integer;
-- 1 when every object the query names had a known size, 0 when est_rows is only a lower bound.
alter table "query_log" add column "est_complete" integer;
