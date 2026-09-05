---
name: Google account switching
description: Durable OAuth constraints for switching Google Drive accounts on one device.
---

Google account switching must explicitly show the Google account chooser and must not reuse a stored Drive refresh token when the authenticated email changes.

**Why:** Google may omit a refresh token when an account has already granted consent. Reusing the device's previous token in that case can make the UI show the new email while backups still use the old Google Drive account.

**How to apply:** Clear the old device connection before starting a switch, request `select_account` plus consent, and reject any server-side email/token mismatch instead of silently retaining the old token.

Backup conflict metadata is account-specific and must be keyed by the verified Google email, not shared across accounts on one device.

**Why:** A revision remembered from account A can make a pre-existing backup in account B look like an unobserved concurrent change, blocking valid backups or showing the wrong status.

**How to apply:** Scope local backup revision and last-backup metadata to the normalized authenticated email, and keep those metadata keys out of the business-data backup payload.