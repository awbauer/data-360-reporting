/*---
title: "Identity resolution: overlap between data sources"
description: "For each pair of data sources, how many unified profiles contain records from both. This is a self-join on the link object, so it scans it twice: mind the credits on large orgs. Uses IndividualIdentityLink__dlm, the link between source and unified profiles. Object and field names are the defaults and have not been checked against a live org yet; orgs with several match rulesets may use different names, so edit them if the query fails."
tags: ["identity", "needs-verification"]
---*/

SELECT a."ssot__DataSourceId__c" AS "source_a",
       b."ssot__DataSourceId__c" AS "source_b",
       COUNT(DISTINCT a."UnifiedRecordId__c") AS "shared_unified_profiles"
FROM "IndividualIdentityLink__dlm" AS a
JOIN "IndividualIdentityLink__dlm" AS b
  ON a."UnifiedRecordId__c" = b."UnifiedRecordId__c"
 AND a."ssot__DataSourceId__c" < b."ssot__DataSourceId__c"
GROUP BY a."ssot__DataSourceId__c", b."ssot__DataSourceId__c"
ORDER BY "shared_unified_profiles" DESC
