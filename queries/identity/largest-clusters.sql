/*---
title: "Identity resolution: largest clusters"
description: "Unified profiles built from the most source profiles, with how many data sources they span (taken from the source individual). Start here when hunting over-matching. The object and column names (IndividualIdentityLink__dlm, UnifiedRecordId__c, SourceRecordId__c, KQ_SourceRecordId__c) come from Salesforce's own Connect API examples and have not been run against a live org. A ruleset that writes to differently named objects needs the names edited (Setup, Identity Resolution lists them)."
tags: ["identity", "needs-verification"]
params:
  - {"name": "min_size", "type": "integer", "label": "At least this many source profiles", "default": "3"}
  - {"name": "n", "type": "integer", "label": "Max rows", "default": "50"}
---*/

SELECT l."UnifiedRecordId__c" AS "unified_id",
       COUNT(*) AS "source_profiles",
       COUNT(DISTINCT i."ssot__DataSourceId__c") AS "data_sources"
FROM "IndividualIdentityLink__dlm" AS l
JOIN "ssot__Individual__dlm" AS i
  ON l."SourceRecordId__c" = i."ssot__Id__c"
 AND l."KQ_SourceRecordId__c" = i."KQ_Id__c"
GROUP BY l."UnifiedRecordId__c"
HAVING COUNT(*) >= :min_size
ORDER BY "source_profiles" DESC
LIMIT :n
