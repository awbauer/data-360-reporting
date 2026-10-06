/*---
title: "Individuals with many email addresses"
description: "Individuals linked to more than a threshold number of email contact points. Useful for spotting duplicate or shared addresses."
tags: ["email", "quality"]
params:
  - {"name": "min_emails", "type": "integer", "label": "More than this many emails", "default": "1"}
---*/

SELECT i."ssot__Id__c" AS "individual_id",
       i."ssot__LastName__c" AS "last_name",
       COUNT(e."ssot__Id__c") AS "emails"
FROM "ssot__Individual__dlm" i
JOIN "ssot__ContactPointEmail__dlm" e ON e."ssot__PartyId__c" = i."ssot__Id__c"
GROUP BY i."ssot__Id__c", i."ssot__LastName__c"
HAVING COUNT(e."ssot__Id__c") > :min_emails
ORDER BY "emails" DESC
LIMIT 200
