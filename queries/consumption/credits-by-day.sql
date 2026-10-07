/*---
title: "Consumption: credits by day and card"
description: "Credits actually consumed each day, per consumption card and environment, from Digital Wallet's TenantDailyEntitlementConsumption data lake object (add it to this data space first; Credits > Actual consumption checks). Object, field names and the date cast follow Salesforce's 'Build a Credit Feedback Loop for Data 360'; names are unquoted as in Salesforce's examples."
tags: ["consumption", "credits", "digital-wallet"]
params:
  - {"name": "since", "type": "date", "label": "Since", "default": "2026-01-01"}
---*/

SELECT CAST(utilizationdate__c AS DATE) AS "usage_day",
       carddefinitiondevelopername__c AS "card",
       usagebusinessenvtype__c AS "environment",
       SUM(unitsconsumed__c) AS "credits"
FROM TenantDailyEntitlementConsumption__dll
WHERE CAST(utilizationdate__c AS DATE) >= :since
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 4 DESC
