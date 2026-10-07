/*---
title: "Consumption: top resources"
description: "Which segments, insights, streams, transforms and identity resolution rulesets consumed the most credits since a date, from TenantHourlyEntitlementConsumption. Rows still being processed are excluded, as Salesforce advises. Hourly data covers recent weeks only."
tags: ["consumption", "credits", "digital-wallet"]
params:
  - {"name": "since", "type": "date", "label": "Since", "default": "2026-01-01"}
  - {"name": "n", "type": "integer", "label": "Rows", "default": "25"}
---*/

SELECT resourcetype__c AS "resource_type",
       resourceidorapiname__c AS "resource",
       SUM(unitsconsumed__c) AS "credits"
FROM TenantHourlyEntitlementConsumption__dll
WHERE CAST(usagehourbucket__c AS TIMESTAMP) >= :since
  AND rowdetail__c = 'PROCESSED'
GROUP BY 1, 2
ORDER BY 3 DESC
LIMIT :n
