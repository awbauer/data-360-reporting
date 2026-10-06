/*---
title: "Individual field completeness"
description: "Share of individuals with a value for each key attribute."
tags: ["profile", "quality"]
---*/

SELECT COUNT(*) AS "individuals",
       COUNT("ssot__FirstName__c") * 1.0 / COUNT(*) AS "first_name_filled",
       COUNT("ssot__LastName__c") * 1.0 / COUNT(*) AS "last_name_filled",
       COUNT("ssot__BirthDate__c") * 1.0 / COUNT(*) AS "birth_date_filled",
       COUNT("ssot__YearlyIncome__c") * 1.0 / COUNT(*) AS "income_filled"
FROM "ssot__Individual__dlm"
