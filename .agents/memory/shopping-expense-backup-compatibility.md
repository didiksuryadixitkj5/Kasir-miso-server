---
name: Shopping expense backup compatibility
description: Compatibility rule for automatic shopping expense identity across backup and restore.
---

Automatic shopping expense deduplication depends on the shopping item ID surviving serialization and hydration. Expenses created by older app versions may not have that optional link and must remain valid restore data.

**Why:** Losing the link causes a restored shopping item to be recorded again, while rejecting old records would make otherwise usable backups fail to restore.

**How to apply:** Preserve non-empty shopping item IDs during backup/restore normalization, and treat a missing or invalid optional ID as a legacy expense rather than as a malformed backup.