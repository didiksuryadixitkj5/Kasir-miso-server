---
name: Imported mobile artifact registration
description: Replit project behavior when importing an existing Expo artifact from a repository
---

When an imported repository contains an Expo app but the project artifact inventory does not list it, register the Expo artifact before starting its preview workflow. Preserve the imported app source and replace only the generated scaffold files needed for artifact registration.

**Why:** Copying repository files alone restored the source but did not create a managed Expo workflow or preview entry.

**How to apply:** After importing an existing mobile app, check the artifact inventory, register the missing Expo artifact, restore its source, reinstall dependencies, run Expo dependency checks, then restart the managed workflow.