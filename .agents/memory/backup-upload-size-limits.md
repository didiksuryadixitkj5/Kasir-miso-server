---
name: ZIP backup transfer limits
description: Keep image-heavy backups as one ZIP while protecting the API proxy and server from oversized JSON payloads.
---

Store image-heavy backups as one ZIP archive, but move the archive across the API boundary as bounded binary chunks and stream those chunks to Google Drive's resumable upload. Stream the archive back during restore instead of buffering it in a JSON response. Keep restore compatibility for legacy JSON backups.

**Why:** Embedded images inflate Base64 JSON payloads and can hit proxy request limits before Express receives them. Server-side JSON assembly also duplicates large payloads in memory.

**How to apply:** Use bounded raw binary requests that satisfy the destination's resumable-upload chunk requirements; forward chunks without assembling the archive in server memory. Reuse one upload request ID across retries so repeated start/chunk requests remain idempotent. On mobile, read and write ZIP bytes directly instead of Base64 strings. Validate archive size and contents on restore, and retain support for older JSON archives.

The Expo development workflow must override any stale `EXPO_PUBLIC_API_BASE_URL` so preview requests target the current API Server workflow. The production fallback remains separate for standalone builds.

**Why:** A fresh client bundle can correctly call the chunk endpoint while an old published API deployment still returns `Cannot PUT /api/google/backup/chunk`.