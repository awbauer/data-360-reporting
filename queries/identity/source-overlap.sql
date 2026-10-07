/*---
title: "Identity resolution: overlap between data sources"
description: "For each pair of data sources, how many unified profiles contain records from both. It reduces the links to one row per unified profile and source first, then pairs those up, so the large objects are scanned once. The object and column names (IndividualIdentityLink__dlm, UnifiedRecordId__c, SourceRecordId__c, KQ_SourceRecordId__c) come from Salesforce's own Connect API examples and have not been run against a live org. A ruleset that writes to differently named objects needs the names edited (Setup, Identity Resolution lists them)."
tags: ["identity", "needs-verification"]
---*/

WITH "per_source" AS (
  SELECT DISTINCT l."UnifiedRecordId__c" AS "unified_id",
                  i."ssot__DataSourceId__c" AS "data_source"
  FROM "IndividualIdentityLink__dlm" AS l
  JOIN "ssot__Individual__dlm" AS i
    ON l."SourceRecordId__c" = i."ssot__Id__c"
   AND l."KQ_SourceRecordId__c" = i."KQ_Id__c"
)
SELECT a."data_source" AS "source_a",
       b."data_source" AS "source_b",
       COUNT(*) AS "shared_unified_profiles"
FROM "per_source" AS a
JOIN "per_source" AS b
  ON a."unified_id" = b."unified_id"
 AND a."data_source" < b."data_source"
GROUP BY a."data_source", b."data_source"
ORDER BY "shared_unified_profiles" DESC
