/*---
title: "Identity resolution: profiles by data source"
description: "For each data source, its linked source profiles and the unified profiles they map to. Fewer unified than source profiles means records merged within that source. Uses IndividualIdentityLink__dlm, the link between source and unified profiles. Object and field names are the defaults and have not been checked against a live org yet; orgs with several match rulesets may use different names, so edit them if the query fails."
tags: ["identity", "needs-verification"]
---*/

SELECT "ssot__DataSourceId__c" AS "data_source",
       COUNT(*) AS "source_profiles",
       COUNT(DISTINCT "UnifiedRecordId__c") AS "unified_profiles"
FROM "IndividualIdentityLink__dlm"
GROUP BY "ssot__DataSourceId__c"
ORDER BY "source_profiles" DESC
