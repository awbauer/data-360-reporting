/*---
title: "Identity resolution: profiles by data source"
description: "For each data source, its linked source profiles and the unified profiles they map to. Fewer unified than source profiles means records merged within that source. The object and column names (IndividualIdentityLink__dlm, UnifiedRecordId__c, SourceRecordId__c, KQ_SourceRecordId__c) come from Salesforce's own Connect API examples and have not been run against a live org. A ruleset that writes to differently named objects needs the names edited (Setup, Identity Resolution lists them)."
tags: ["identity", "needs-verification"]
---*/

SELECT i."ssot__DataSourceId__c" AS "data_source",
       COUNT(*) AS "source_profiles",
       COUNT(DISTINCT l."UnifiedRecordId__c") AS "unified_profiles"
FROM "IndividualIdentityLink__dlm" AS l
JOIN "ssot__Individual__dlm" AS i
  ON l."SourceRecordId__c" = i."ssot__Id__c"
 AND l."KQ_SourceRecordId__c" = i."KQ_Id__c"
GROUP BY i."ssot__DataSourceId__c"
ORDER BY "source_profiles" DESC
