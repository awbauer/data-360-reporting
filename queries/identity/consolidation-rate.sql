/*---
title: "Identity resolution: consolidation rate"
description: "Source profiles linked by identity resolution, the unified profiles they became, and the share merged away. The object and column names (IndividualIdentityLink__dlm, UnifiedRecordId__c, SourceRecordId__c, KQ_SourceRecordId__c) come from Salesforce's own Connect API examples and have not been run against a live org. A ruleset that writes to differently named objects needs the names edited (Setup, Identity Resolution lists them)."
tags: ["identity", "needs-verification"]
---*/

SELECT COUNT(*) AS "source_profiles",
       COUNT(DISTINCT "UnifiedRecordId__c") AS "unified_profiles",
       ROUND(1 - CAST(COUNT(DISTINCT "UnifiedRecordId__c") AS DOUBLE PRECISION) / NULLIF(COUNT(*), 0), 4) AS "consolidation_rate"
FROM "IndividualIdentityLink__dlm"
