---
name: GitHub repository imports
description: Reliable repository transfer through the connected GitHub integration
---

Use the authenticated Git tree/blob API for repository imports. Archive downloads may be blocked by the connector proxy, and blob requests should be paced to avoid transient rate limits.

**Why:** The connector can expose repository metadata while denying archive endpoints or bursty blob requests.

**How to apply:** Fetch the recursive tree, request each blob with the repository-qualified GitHub path, and write files in small paced batches.