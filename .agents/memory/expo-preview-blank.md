---
name: Expo preview blank-screen safeguards
description: Expo web previews can stay blank when root font gating never settles, and test files inside app are treated as routes.
---

Expo Router scans files under `app/` as routes, so component tests must live outside that directory. On web, optional font loading should never block the root layout indefinitely; render with fallback fonts and keep a timeout/error path for native loading.

**Why:** A test file inside a tab route caused Metro bundling to fail, and a web font-loading promise left the entire preview blank without a browser error.

**How to apply:** Keep tests in a dedicated non-route directory and make splash/font gating non-blocking on web with a bounded fallback.