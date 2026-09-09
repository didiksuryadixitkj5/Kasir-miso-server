---
name: Expo component test harness
description: Non-obvious setup needed to render Expo React Native screens with Vitest in the Node test environment.
---

Vitest cannot parse the Flow syntax in the React Native package entrypoint or provide Expo native modules by itself. Component tests should use a local alias config, mock the small native surface used by the screen, and mock unrelated native-only utilities such as image persistence.

**Why:** The app runs in Expo, but the existing unit-test runner executes under Node; importing the full native runtime causes parser and TurboModule failures before tests can run.

**How to apply:** Reuse the app's Vitest alias/setup and keep screen tests focused on event props and provider state rather than attempting to boot Expo native services.