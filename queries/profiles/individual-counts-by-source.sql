/*---
title: "Individuals by data source"
description: "How many unified-profile individuals each data source contributes."
tags: ["profile", "overview"]
---*/

SELECT "ssot__DataSourceId__c" AS "data_source",
       COUNT(*) AS "individuals"
FROM "ssot__Individual__dlm"
GROUP BY "ssot__DataSourceId__c"
ORDER BY "individuals" DESC
