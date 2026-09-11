---
name: Large backup upload limits
description: The public preview path can reject large backup requests before the API server receives them.
---

Large Google Drive backup payloads must be split into bounded requests before they cross the public preview or deployment proxy. Raising the Express JSON parser limit alone does not solve a proxy-level 413.

**Why:** Embedded QRIS and menu images can make an otherwise valid local backup exceed the upstream request-size limit, returning an HTML 413 before the API route can format a useful error.

**How to apply:** Route every client upload, including small backups, through bounded chunks comfortably below the proxy limit and assemble them server-side before the Drive upload. Expire incomplete upload sessions.

The Expo development workflow must override any stale `EXPO_PUBLIC_API_BASE_URL` so preview requests target the current API Server workflow. The production fallback remains separate for standalone builds.

**Why:** A fresh client bundle can correctly call the chunk endpoint while an old published API deployment still returns `Cannot PUT /api/google/backup/chunk`.