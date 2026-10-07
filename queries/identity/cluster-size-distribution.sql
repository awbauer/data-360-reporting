/*---
title: "Identity resolution: cluster sizes"
description: "How many source profiles each unified profile combines. A long tail of very large clusters usually means over-matching (a shared email or phone, for example). Chart it as bars. Uses IndividualIdentityLink__dlm, the link between source and unified profiles. Object and field names are the defaults and have not been checked against a live org yet; orgs with several match rulesets may use different names, so edit them if the query fails."
tags: ["identity", "needs-verification", "chart"]
---*/

SELECT "cluster_size",
       COUNT(*) AS "unified_profiles",
       SUM("cluster_size") AS "source_profiles"
FROM (
  SELECT "UnifiedRecordId__c", COUNT(*) AS "cluster_size"
  FROM "IndividualIdentityLink__dlm"
  GROUP BY "UnifiedRecordId__c"
) AS "clusters"
GROUP BY "cluster_size"
ORDER BY "cluster_size"
