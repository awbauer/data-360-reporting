/*---
title: "Identity resolution: individuals without a unified profile"
description: "Source individuals that no identity link points to: not yet processed, excluded by the ruleset, or loaded after the last run. Matches on the key qualifier as well as the id, as Salesforce's own examples do, so ids reused by different sources aren't confused. The object and column names (IndividualIdentityLink__dlm, UnifiedRecordId__c, SourceRecordId__c, KQ_SourceRecordId__c) come from Salesforce's own Connect API examples and have not been run against a live org. A ruleset that writes to differently named objects needs the names edited (Setup, Identity Resolution lists them)."
tags: ["identity", "needs-verification", "quality"]
---*/

SELECT COUNT(*) AS "individuals_without_link"
FROM "ssot__Individual__dlm" AS i
LEFT JOIN "IndividualIdentityLink__dlm" AS l
  ON l."SourceRecordId__c" = i."ssot__Id__c"
 AND l."KQ_SourceRecordId__c" = i."KQ_Id__c"
WHERE l."SourceRecordId__c" IS NULL
