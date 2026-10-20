---
name: Expo missing installed dependencies
description: Diagnose Metro resolution failures when an Expo dependency is listed in the manifest and lockfile but absent from node_modules.
---

If Metro reports that an Expo package cannot be resolved, check the package link under the artifact's `node_modules` before changing source imports or versions. A package may already be declared and locked but not materialized in the workspace install. Reconcile the workspace with `pnpm install --filter @workspace/kasir-miso...`, then restart the Expo workflow.

**Why:** A missing installed package caused Metro bundling to fail for every route, presenting as a completely white preview despite passing TypeScript and tests.

**How to apply:** For Expo preview-wide blank screens, inspect bundler logs first. If the missing module is already listed in `package.json` and the lockfile, repair workspace installation rather than altering dependency declarations.
