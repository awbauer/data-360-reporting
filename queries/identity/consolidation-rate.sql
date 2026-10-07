/*---
title: "Identity resolution: consolidation rate"
description: "Source profiles linked by identity resolution, the unified profiles they became, and the share merged away. Uses IndividualIdentityLink__dlm, the link between source and unified profiles. Object and field names are the defaults and have not been checked against a live org yet; orgs with several match rulesets may use different names, so edit them if the query fails."
tags: ["identity", "needs-verification"]
---*/

SELECT COUNT(*) AS "source_profiles",
       COUNT(DISTINCT "UnifiedRecordId__c") AS "unified_profiles",
       ROUND(1 - CAST(COUNT(DISTINCT "UnifiedRecordId__c") AS DOUBLE PRECISION) / NULLIF(COUNT(*), 0), 4) AS "consolidation_rate"
FROM "IndividualIdentityLink__dlm"
