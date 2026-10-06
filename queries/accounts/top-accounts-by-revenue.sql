/*---
title: "Top accounts by revenue in an industry"
tags: ["account"]
params:
  - {"name": "industry", "type": "string", "label": "Industry", "default": "Retail"}
  - {"name": "n", "type": "integer", "label": "Max rows", "default": "20"}
---*/

SELECT "ssot__Name__c" AS "account",
       "ssot__Industry__c" AS "industry",
       "ssot__AnnualRevenue__c" AS "annual_revenue"
FROM "ssot__Account__dlm"
WHERE "ssot__Industry__c" = :industry
ORDER BY "annual_revenue" DESC
LIMIT :n
