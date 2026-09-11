---
name: Expo print package alignment
description: Expo SDK 54 requires the SDK-matched expo-print and expo-sharing versions for native receipt printing.
---

Use the versions reported by Expo's compatibility check for native modules instead of guessing older package versions. For the current SDK 54 toolchain, receipt printing uses the matched `expo-print` and `expo-sharing` releases declared by the Kasir Miso artifact.

**Why:** Older module versions bundled successfully but emitted compatibility warnings and could fail on a physical device.

**How to apply:** When adding an Expo native capability, install it in the target workspace package, run the Expo compatibility check or production bundle, and align the package version before finishing.