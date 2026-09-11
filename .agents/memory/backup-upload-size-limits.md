---
name: Large backup upload limits
description: The public preview path can reject large backup requests before the API server receives them.
---

Large Google Drive backup payloads must be split into bounded requests before they cross the public preview or deployment proxy. Raising the Express JSON parser limit alone does not solve a proxy-level 413.

**Why:** Embedded QRIS and menu images can make an otherwise valid local backup exceed the upstream request-size limit, returning an HTML 413 before the API route can format a useful error.

**How to apply:** Keep the client chunk size comfortably below the proxy limit and assemble the chunks server-side before the Drive upload. Keep the direct endpoint for small backups and expire incomplete upload sessions.