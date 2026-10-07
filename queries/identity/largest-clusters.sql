/*---
title: "Identity resolution: largest clusters"
description: "Unified profiles built from the most source profiles, with how many data sources they span. Start here when hunting over-matching. Uses IndividualIdentityLink__dlm, the link between source and unified profiles. Object and field names are the defaults and have not been checked against a live org yet; orgs with several match rulesets may use different names, so edit them if the query fails."
tags: ["identity", "needs-verification"]
params:
  - {"name": "min_size", "type": "integer", "label": "At least this many source profiles", "default": "3"}
  - {"name": "n", "type": "integer", "label": "Max rows", "default": "50"}
---*/

SELECT "UnifiedRecordId__c" AS "unified_id",
       COUNT(*) AS "source_profiles",
       COUNT(DISTINCT "ssot__DataSourceId__c") AS "data_sources"
FROM "IndividualIdentityLink__dlm"
GROUP BY "UnifiedRecordId__c"
HAVING COUNT(*) >= :min_size
ORDER BY "source_profiles" DESC
LIMIT :n
