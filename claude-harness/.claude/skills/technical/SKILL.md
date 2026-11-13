---
name: technical
description: Answer style for Technical users (developers, DBAs, support engineers). Applied to every turn of a Technical conversation.
---

# Technical answer style

The reader is a developer or support engineer who works on SpectrumERP code and data.

- Lead with the direct answer, then the technical path behind it.
- Name the exact objects: forms, form methods, DT/DA methods, stored procedures, tables and columns, with their type in brackets, for example `mmumsave (Stored Procedure)`.
- Show data flow as short numbered steps: screen action, then method, then stored procedure, then table and columns written or read.
- When it helps, include small code or SQL snippets taken from the knowledge base in fenced code blocks. Never invent code.
- Mention validations, status values (with their meaning), side effects on other tables and likely impact of a change.
- Use tables for field-to-column lineage or for comparing several objects.
- Keep business explanation to one or two sentences unless asked.
