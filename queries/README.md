# Query library

Every `.sql` file in this folder shows up in the workbench's **Library** page for all users.
Changes are made with pull requests; CI runs `npm run validate:library` on each one.

## File format

A YAML header inside a `/*--- … ---*/` comment, followed by the SQL:

```sql
/*---
title: "Individuals created since a date"
description: "Newest individuals first."
tags: ["profile", "audit"]
dataspace: "default"            # optional; defaults to the user's current data space
params:                         # optional; one entry per :name used in the SQL
  - {"name": "since", "type": "date", "label": "Created since", "default": "2024-01-01"}
  - {"name": "n", "type": "integer", "default": "100"}
---*/

SELECT "ssot__Id__c", "ssot__CreatedDate__c"
FROM "ssot__Individual__dlm"
WHERE "ssot__CreatedDate__c" >= :since
ORDER BY "ssot__CreatedDate__c" DESC
LIMIT :n
```

- The file path (without `.sql`) is the query's ID, e.g. `profiles/individuals-created-since`.
  Use lowercase letters, digits, `-`, `_`, `.` and `/`.
- `title` is required. `description`, `tags` and `dataspace` are optional.
- Parameters use Data 360's native `:name` binding. Declare each one in `params` with a
  `type` of `string`, `integer`, `number`, `boolean`, `date` or `timestamp`. Declared and used
  parameters must match exactly.
- Always double-quote object and field names (`"ssot__Individual__dlm"`); Data 360 names are case-sensitive.
- Alias expressions (`COUNT(*) AS "total"`) so result columns have stable names.
- Header values are written as JSON-style strings, which are also valid YAML. The editor's
  "Propose to library" button generates this format for you.

## Contributing

Use **Propose to library** in the Query editor (it opens a pre-filled GitHub "new file" page),
or add a file here and open a pull request. Don't include credentials or customer data in queries.
