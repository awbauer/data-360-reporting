/*---
title: "Consumption: unusually expensive days"
description: "Days on which a card consumed more than 1.5 times its average over the period: Salesforce's own anomaly query from 'Build a Credit Feedback Loop for Data 360', with the start date as a parameter. Look at the resources that ran those days next (Consumption: top resources)."
tags: ["consumption", "credits", "digital-wallet"]
params:
  - {"name": "since", "type": "date", "label": "Since", "default": "2026-01-01"}
---*/

WITH daily AS (
  SELECT CAST(utilizationdate__c AS DATE) AS usage_day,
         carddefinitiondevelopername__c AS card,
         SUM(unitsconsumed__c) AS credits
  FROM TenantDailyEntitlementConsumption__dll
  WHERE CAST(utilizationdate__c AS DATE) >= :since
  GROUP BY 1, 2
),
scored AS (
  SELECT usage_day, card, credits, AVG(credits) OVER (PARTITION BY card) AS avg_per_day
  FROM daily
)
SELECT usage_day AS "usage_day", card AS "card", credits AS "credits", avg_per_day AS "avg_per_day"
FROM scored
WHERE credits > avg_per_day * 1.5
ORDER BY credits - avg_per_day DESC
