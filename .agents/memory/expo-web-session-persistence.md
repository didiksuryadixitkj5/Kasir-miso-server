---
name: Expo web session persistence
description: Preview web dapat membuat ulang dokumen saat navigasi; sesi Google dan device identity harus memakai storage persisten.
---

Untuk autentikasi Google Drive di Expo web, simpan token sesi, expiry, dan device ID di `localStorage`; gunakan `sessionStorage` hanya untuk data OAuth sementara seperti verifier.

**Why:** Preview web dapat membuat ulang dokumen saat berpindah route/tab. Jika identitas perangkat dan token hanya ada di `sessionStorage`, server menerima kombinasi sesi-device yang hilang atau berubah dan aplikasi meminta login ulang.

**How to apply:** Migrasikan nilai lama dari `sessionStorage` saat dibaca, hapus cleanup `AsyncStorage` yang memakai key token sesi yang sama, dan tetap gunakan SecureStore di Android/iOS.