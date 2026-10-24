---
name: OpenAPI email format and Zod codegen
description: Keep OpenAPI string formats compatible with the workspace's Orval and Zod code generation.
---

With the current Orval/Zod pipeline, adding `format: email` to an OpenAPI string generated `zod.email()`, which is not available in the workspace's Zod 3 setup. Represent email as a plain string in the OpenAPI schema unless the Zod version or generator output has been updated.

**Why:** The schema generation command failed during a native Google Sign-In API addition because of this generated API mismatch.

**How to apply:** Before using string formats that emit Zod helpers, confirm the generated code matches the installed Zod API; otherwise validate the value separately.
