---
name: Generated API declarations
description: Workspace typechecking can resolve the shared API client through generated declaration output.
---

When an artifact reports that exports are missing from the shared API client even though they exist in its source entrypoint, rebuild the shared client declarations before changing application imports.

**Why:** The artifact project can typecheck against generated declaration output that lags behind the source package, producing misleading missing-export errors.

**How to apply:** Verify the source export first, rebuild the shared API client package, then rerun the artifact typecheck.