/*---
title: "Identity resolution: cluster sizes"
description: "How many source profiles each unified profile combines. A long tail of very large clusters usually means over-matching (a shared email or phone, for example). Chart it as bars. The object and column names (IndividualIdentityLink__dlm, UnifiedRecordId__c, SourceRecordId__c, KQ_SourceRecordId__c) come from Salesforce's own Connect API examples and have not been run against a live org. A ruleset that writes to differently named objects needs the names edited (Setup, Identity Resolution lists them)."
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
