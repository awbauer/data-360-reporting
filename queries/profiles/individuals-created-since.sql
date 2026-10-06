/*---
title: "Individuals created since a date"
description: "Newest individuals first, limited to the most recent rows."
tags: ["profile", "audit"]
params:
  - {"name": "since", "type": "date", "label": "Created since", "default": "2024-01-01"}
  - {"name": "n", "type": "integer", "label": "Max rows", "default": "100"}
---*/

SELECT "ssot__Id__c",
       "ssot__FirstName__c",
       "ssot__LastName__c",
       "ssot__CreatedDate__c"
FROM "ssot__Individual__dlm"
WHERE "ssot__CreatedDate__c" >= :since
ORDER BY "ssot__CreatedDate__c" DESC
LIMIT :n
