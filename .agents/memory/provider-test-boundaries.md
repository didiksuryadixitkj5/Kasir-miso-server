---
name: Node-testable mobile provider policies
description: How to regression-test Expo account and backup-provider behavior without loading native modules.
---

Keep account switching, logout branching, and backup metadata rules in dependency-free policy modules, while the React Native providers only connect those policies to Expo and storage APIs.

**Why:** Node-based Vitest cannot parse or initialize Expo's native React Native entry points, but these security-sensitive decisions still need automated regression coverage.

**How to apply:** Test policy modules directly for cancellation, logout failure/revocation, and account-scoped metadata; reserve device-level tests for native OAuth and storage integration.