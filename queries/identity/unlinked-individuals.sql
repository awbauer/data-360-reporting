/*---
title: "Identity resolution: individuals without a unified profile"
description: "Source individuals that no identity link points to: not yet processed, excluded by the ruleset, or loaded after the last run. Uses IndividualIdentityLink__dlm, the link between source and unified profiles. Object and field names are the defaults and have not been checked against a live org yet; orgs with several match rulesets may use different names, so edit them if the query fails."
tags: ["identity", "needs-verification", "quality"]
---*/

SELECT COUNT(*) AS "individuals_without_link"
FROM "ssot__Individual__dlm" AS i
LEFT JOIN "IndividualIdentityLink__dlm" AS l
  ON l."SourceRecordId__c" = i."ssot__Id__c"
WHERE l."SourceRecordId__c" IS NULL
