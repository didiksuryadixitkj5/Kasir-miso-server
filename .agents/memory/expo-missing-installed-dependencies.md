---
name: Expo missing installed dependencies
description: Diagnose Metro resolution failures when an Expo dependency is listed in the manifest and lockfile but absent from node_modules.
---

If Metro reports that an Expo package cannot be resolved, check the package link under the artifact's `node_modules` before changing source imports or versions. A package may already be declared and locked but not materialized in the workspace install. Reconcile the filtered workspace install, then restart the Expo workflow.

If the install is blocked because a transitive package version is rejected by the package firewall, check for a newer safe release and update the transitive resolution through a workspace override when the parent dependency range allows it. Do not bypass the firewall.

**Why:** Missing installed packages prevent Metro from bundling any route, a rejected transitive archive can leave the workspace partially installed even when the lockfile is valid, and a filtered install can prune links needed by other running artifacts.

**How to apply:** For Expo preview-wide blank screens, inspect bundler logs first. If the missing module is already listed in `package.json` and the lockfile, repair workspace installation rather than altering source imports or dependency versions. If the firewall rejects a transitive archive, verify current package metadata before updating its resolution. After a filtered install in a multi-artifact workspace, run a full `pnpm install` and restart any affected workflows.
