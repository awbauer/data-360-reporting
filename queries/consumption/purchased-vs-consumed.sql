/*---
title: "Consumption: purchased vs consumed, by card"
description: "Credits bought (TenantEntitlementTransaction) against credits consumed since a date (TenantDailyEntitlementConsumption), per consumption card. Set the date to the contract start. The card column on the entitlement object is an assumption: Salesforce's post says purchases are per card without naming the column."
tags: ["consumption", "credits", "digital-wallet", "needs-verification"]
params:
  - {"name": "since", "type": "date", "label": "Contract start", "default": "2026-01-01"}
---*/

SELECT p.card AS "card",
       p.purchased AS "purchased",
       COALESCE(c.consumed, 0) AS "consumed",
       p.purchased - COALESCE(c.consumed, 0) AS "remaining"
FROM (
  SELECT carddefinitiondevelopername__c AS card, SUM(quantity__c) AS purchased
  FROM TenantEntitlementTransaction__dll
  GROUP BY 1
) p
LEFT JOIN (
  SELECT carddefinitiondevelopername__c AS card, SUM(unitsconsumed__c) AS consumed
  FROM TenantDailyEntitlementConsumption__dll
  WHERE CAST(utilizationdate__c AS DATE) >= :since
  GROUP BY 1
) c ON c.card = p.card
ORDER BY 1
