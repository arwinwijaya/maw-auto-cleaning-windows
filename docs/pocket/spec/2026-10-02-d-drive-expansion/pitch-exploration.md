# Pitch Exploration: D-Drive Expansion
Date: 2026-10-02 | Project: auto-cleaning (Cleanup Web Scanner) | Status: pitch-only

---

## Problem Statement
Cleanup Web Scanner saat ini hanya memindai path di drive `C:`, sementara pengguna membutuhkan pemantauan dan pengelolaan ruang pada folder penting di drive `D:` (`D:\Temp`, `D:\tmp`, `D:\Program`, `D:\Program Files`).

## Root Tension
Keinginan untuk memperluas visibilitas ruang disk ke drive sekunder (D:) berbenturan dengan fakta bahwa folder di dalam `D:\Program Files` bukan file temp/cache yang bisa dihapus sembarangan, melainkan aplikasi terinstal yang memerlukan perlakuan observasi (bukan pembersihan langsung).

## Key Constraints
- Deduplikasi `D:\Temp` dan `D:\tmp` (karena Windows case-insensitive, disatukan menjadi satu entri logis).
- `D:\Program` dan `D:\Program Files` dikategorikan sebagai observability-only (grup `app`/`other`), dengan panduan "uninstall, jangan hapus".
- Docker container dan native Windows harus sama-sama mendukung multi-drive mount (`/mnt/c` dan `/mnt/d`).
- Seluruh tes yang ada (`npm test`) wajib tetap 100% pass (invarian read-only terjaga).

---

## Approach Directions

### Direction A: Automatic Drive Mapping & Multi-Mount Whitelist (Recommended)
Memperbarui built-in whitelist di `server.js`, menambahkan grup `app`, mendeteksi huruf drive secara otomatis (`C:` -> `/mnt/c`, `D:` -> `/mnt/d`), dan menambahkan bind mount D: di `docker-compose.yml`.
+ Out-of-the-box langsung jalan, pemisahan aman antara temp dan program files, remapping otomatis.
− Sedikit penyesuaian pada helper remapping container.

### Direction B: Explicit SCAN_ROOTS Override Only
Membiarkan default whitelist C: tetap, dan mengandalkan `SCAN_ROOTS` environment variable untuk memasukkan path D:.
+ Kode server inti tidak berubah.
− Pengguna harus manual konfigurasi JSON env var.

### Direction C: Separate D: Tab in UI
Membuat tab khusus drive D: terpisah dari C:.
+ Pemisahan domain bersih.
− Overkill dan menambah kompleksitas routing.

---

## Recommended Direction
Direction A — otomatis, aman, dan langsung terintegrasi dengan struktur whitelist yang sudah ada.

---

## Handoff Options
1. Invoke pocket-grinding now (starts from this pitch)
2. Iterate on specific phase before proceeding
3. Save and stop here — come back later
