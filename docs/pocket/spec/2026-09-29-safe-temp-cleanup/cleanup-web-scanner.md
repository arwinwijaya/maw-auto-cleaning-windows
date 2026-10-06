# Cleanup Web Scanner

**Date:** 2026-09-29
**Status:** draft
**Author:** brainstorm session
**Spec path:** docs/pocket/spec/2026-09-29-safe-temp-cleanup/cleanup-web-scanner.md

---

## Summary

Aplikasi web lokal (read-only) yang memindai 5 folder temp/cache sistem Windows, menampilkan jumlah file dan total ukuran per folder, bisa di-refresh, dan menyertakan tab "Panduan Hapus Aman". Aplikasi **tidak pernah menghapus file apa pun** — pengguna menghapus manual via Explorer setelah membaca panduan. Tujuan: membebaskan ruang C: dengan rasa aman penuh (tanpa risiko salah hapus dari aplikasi).

---

## Context

### Current State
- Proyek greenfield: `auto-cleaning/` hanya berisi `docs/` — belum ada code, git, atau manifest.
- Target: Windows 11 (NT 10.0.26200), PowerShell 5.1, **Node.js v24.16.0** tersedia.
- Dokumen pitch sebelumnya: `docs/pocket/spec/2026-09-29-safe-temp-cleanup/pitch-exploration.md` (Direction C hybrid) — **bergeser** ke web app read-only setelah diskusi user.

### Problem / Motivation
Drive C: penuh karena temp/cache menumpuk, tapi user takut menghapus yang salah. Belum ada cara melihat **apa** yang bisa dihapus + **berapa besar** + **bagaimana cara aman** dalam satu tempat.

### Related Areas
- Whitelist folder: `%TEMP%` user, `C:\Windows\Temp`, `C:\Windows\Prefetch`, `C:\$Recycle.Bin`, `C:\Windows\SoftwareDistribution\Download`

---

## Scope

### In-Scope
- Launcher `start.bat` untuk menjalankan server lokal (sekali klik)
- Backend Node.js (`node:http`) memindai whitelist folder (read-only)
- Frontend vanilla HTML/JS (tanpa build step): ringkasan per-folder — nama, jumlah file, total ukuran
- Tombol **Refresh** untuk pindai ulang
- Tab **"Panduan Hapus Aman"** — konten statis (cara buka di Explorer manual, apa yang TIDAK boleh disentuh, tips umur >14 hari)
- Read-only: aplikasi **tidak pernah** menghapus / menulis file
- Bind **hanya 127.0.0.1**, default port **3456** (env `PORT`)

### Out-of-Scope
- Hapus otomatis dari UI/backend (semua penghapusan manual via Explorer)
- Otomasi terjadwal (Task Scheduler / startup)
- Cache browser (Edge/Chrome/Firefox), Delivery Optimization, Windows.old, pagefile/hiberfil
- Menyentuh `C:\Windows\Installer`, `Documents/Desktop/Downloads/OneDrive`, profil user lain
- Database, autentikasi multi-user, HTTPS, container, remote access, bind `0.0.0.0`, token
- Detail per-file di UI (ringkasan per-folder saja)
- Tombol "Buka di Explorer" (klik dari app)
- Perhitungan umur file per-file di backend (tips >14 hari = teks statis)

---

## Architecture Constraints

- Layers yang boleh disentuh: file baru di root proyek (`server.js`, `start.bat`) + `public/`
- Layers yang TIDAK boleh disentuh: tidak ada — proyek greenfield
- Pola yang wajib:
  - Whitelist > blacklist (hanya 5 path terdaftar yang dipindai)
  - **Read-only invariant**: tidak ada `fs.writeFile` / `fs.unlink` / `fs.rm` / `spawn` / `exec` di mana pun
  - Tidak follow symlink / junction / reparse point (pakai `lstat`, bukan `stat`)
  - Path selalu dikutip saat disusun (spasi)
  - PS 5.1-compatible environment; Node 24.16+
  - Backend & frontend diserve dari **proses yang sama** (same-origin fetch, tanpa build step)
- Architecture validation result: **PASS**

---

## Dependencies

### Existing (to leverage)
- `node:http` — HTTP server + router + static file serving (hand-rolled, ~60 baris)
- `node:fs` / `node:path` / `node:os` — recursive walk, `lstat`, path resolution
- `node:registry` via `child_process` — **read-only** registry lookup untuk resolve `%TEMP%` saat elevated (opsional, fallback ke env var)

### New (proposed)
- **none** (Option A: zero dependency)

*(Build-vs-buy: masalah "HTTP routing + static file serving" adalah commodity → library option **Express** ditawarkan sebagai Option B. Ditolak pada rekomendasi karena aplikasi hanya butuh 1 endpoint GET + static, dan tanpa `npm install` lebih selaras dengan requirement "tanpa dependency berat" + audit read-only. Tidak ada masalah crypto/auth yang di-hand-roll.)*

---

## Stories + Scenarios

### Story: Lihat storage yang bisa dibersihkan
> Sebagai pengguna Windows yang ingin membebaskan ruang C:, saya ingin melihat ukuran folder temp/cache yang aman dibersihkan, supaya tahu apa yang bisa saya hapus tanpa takut merusak data.

**Rule 1: Hanya folder whitelist yang dipindai (5)**
- Example A: `%TEMP%` ada 1.234 file, 2.5 GB → `Local\Temp · 1,234 file · 2.5 GB · ready`
- Example B (edge): `SoftwareDistribution\Download` tidak ada → `not_found`, 0, 0

**Rule 2: Read-only**
- Example C: skrip dijalankan 2× berturut-turut → tidak ada perubahan file sistem

**Rule 3: Rekursif + hidden/system + NO symlink/junction follow**
- Example D: folder berisi junction `Temp\link → D:\Projects\real-data` → `sizeBytes` tidak termasuk isi `D:\Projects\real-data`
- Example E: file hidden/system (`attrib +h`) tetap dihitung
- Example F: junction loop A→B→A → walk berhenti, tidak infinite loop

**Rule 4: Status per folder, bukan 500**
- Example G: `$Recycle.Bin` butuh admin saat server non-elevated → `access_denied`, folder lain tetap `ready`, HTTP 200
- Example H: `$Recycle.Bin\S-1-5-21-xxx` access_denied → parent `partial`

**Rule 5: Locked / vanished file → skip & continue**
- Example I: 1 file `C:\Windows\Temp` terkunci proses berjalan → skip, scan lanjut, folder tetap `ready`
- Example J: file terhapus antara `readdir` dan `stat` (ENOENT) → skip, tidak crash, tidak 500
- Example K: jumlah file ter-skip > 10% `fileCount` folder → folder `partial`

**Rule 6: Elevation tidak mengubah target `%TEMP%`**
- Example L: server dijalankan sebagai Administrator → path yang dipindai tetap `C:\Users\<logged-in>\AppData\Local\Temp`, bukan Temp admin

**Rule 7: Semua folder gagal / tidak ada**
- Example M: semua `access_denied` → HTTP 200, semua `access_denied`, empty-state copy khusus + saran "Run as Administrator"
- Example N: semua `not_found` → HTTP 200, semua `not_found`, empty-state copy berbeda

```gherkin
Scenario: Scan sukses — semua folder terbaca
  Given server Node berjalan di 127.0.0.1:3456 dengan izin admin
  When GET /api/scan
  Then respons berisi 5 entri: name, path, fileCount, sizeBytes, sizeHuman, status "ready"
  And setiap entri punya sizeHuman human-readable (mis. "2.5 GB")

Scenario: Folder tidak ada (fresh Windows)
  Given C:\Windows\SoftwareDistribution\Download tidak ada
  When GET /api/scan
  Then entri Download = not_found, fileCount 0, sizeBytes 0, sizeHuman "0 B"
  And folder lain tetap "ready"

Scenario: Folder diakses tanpa admin
  Given server dijalankan tanpa Run as Administrator
  When GET /api/scan
  Then $Recycle.Bin & Prefetch = access_denied, %TEMP% user = ready
  And respons HTTP 200

Scenario: Elevation tidak mengubah %TEMP%
  Given server dijalankan sebagai Administrator
  When GET /api/scan
  Then path yang dipindai tetap C:\Users\<logged-in>\AppData\Local\Temp

Scenario: Symlink/junction tidak di-follow
  Given Temp berisi junction ke D:\Projects\real-data
  When GET /api/scan
  Then sizeBytes tidak termasuk isi D:\Projects\real-data
  And junction tidak dihitung sebagai file

Scenario: Junction loop berhenti
  Given junction A → B → A di dalam folder temp
  When GET /api/scan
  Then walk berhenti tanpa infinite loop/OOM

Scenario: File terkunci di-skip, folder tetap ready
  Given 1 file di C:\Windows\Temp terkunci
  When GET /api/scan
  Then file di-skip, scan lanjut, status folder "ready"
  And status jadi "partial" hanya bila skip > 10% fileCount

Scenario: File ENOENT di tengah walk
  Given file dihapus antara readdir dan stat
  When GET /api/scan
  Then di-skip, tidak crash, tidak HTTP 500

Scenario: Folder kosong
  Given %TEMP% berisi 0 file
  When GET /api/scan
  Then status "ready", fileCount 0, sizeBytes 0, sizeHuman "0 B"

Scenario: Folder sangat besar / path non-ASCII panjang
  Given folder 100k+ file atau path unicode + spasi + depth > 260
  When GET /api/scan
  Then scan selesai tanpa crash/OOM, sizeHuman konsisten

Scenario: Semua folder access_denied
  Given semua folder gagal diakses
  When GET /api/scan
  Then HTTP 200, semua status "access_denied"
  And UI menampilkan copy khusus + saran "Run as Administrator"

Scenario: Semua folder not_found
  Given semua folder tidak ada
  When GET /api/scan
  Then HTTP 200, semua "not_found", empty-state copy berbeda

Scenario: Endpoint hapus ditolak (unknown path)
  Given app berjalan
  When POST /api/delete
  Then HTTP 404, body {error: "..."}, tidak ada perubahan file

Scenario: Method salah pada path dikenal
  Given app berjalan
  When DELETE /api/scan
  Then HTTP 405, body {error: "..."}, tidak ada perubahan file
```

---

### Story: Refresh data scan
> Sebagai pengguna, saya ingin memperbarui data setelah menghapus file manual.

**Rule 8: Refresh = rescan semua, return `scannedAt` ISO-8601 selesai scan, timezone local**
- Example A: klik Refresh pada 10:05:00 lokal → `scannedAt = "2026-09-29T10:05:00+07:00"`

**Rule 9: Stateless + UI tampilkan request TERAKHIR (requestId)**
- Example B: klik Refresh 3× dalam 1 detik → UI tampilkan hasil request terakhir yang **dikirim**; tak ada error di konsol

**Rule 10: 30s cap total untuk 5 folder; frontend disabled selama menunggu**
- Example C: walk > 30s → `partial: true`, `scannedAt` tetap diisi, entry belum mulai → `partial` dengan `fileCount 0`
- Example D: selama scan → tombol Refresh disabled, label "Memindai…"

**Rule 11: Auto-scan 1× saat halaman pertama dibuka**
- Example E: buka halaman → langsung fetch `/api/scan` sekali, tampilkan hasil

**Rule 12: Top-level `partial: true` diset bila ada ≥1 entry `partial`**
- Example F: hanya `$Recycle.Bin` yang `partial` → `partial: true`, grand total = lower-bound

```gherkin
Scenario: Refresh mengembalikan timestamp baru
  Given scan pertama selesai pada 10:00:00
  When user klik Refresh pada 10:05:00
  Then respons baru punya scannedAt "2026-09-29T10:05:00+07:00"
  And total ukuran mencerminkan data terbaru

Scenario: Rapid Refresh (race)
  Given user klik Refresh 3× dalam 1 detik
  When ketiga request selesai
  Then UI menampilkan hasil request terakhir yang DIKIRIM (requestId ordering)
  And tidak ada error konsol

Scenario: Scan melebihi cap 30 detik
  Given walk melebihi backend cap 30s
  When GET /api/scan
  Then respons punya partial: true, scannedAt terisi
  And entry yang belum mulai = status "partial", fileCount 0
  And HTTP 200

Scenario: Loading state saat menunggu
  Given scan berjalan
  When frontend menunggu respons
  Then tombol Refresh disabled, label "Memindai…"

Scenario: Auto-scan saat load
  Given user baru membuka halaman
  When page load selesai
  Then frontend auto-fetch /api/scan sekali

Scenario: Top-level partial flag
  Given hanya $Recycle.Bin berstatus partial
  When GET /api/scan
  Then top-level partial: true, grand total ditandai lower-bound
```

---

### Story: Panduan hapus aman
> Sebagai pengguna, saya ingin panduan langkah aman untuk hapus manual.

**Rule 13: Konten statis — tanpa tombol Open-in-Explorer, tanpa exec/spawn**
**Rule 14: Panduan selalu terlihat sebagai tab**

```gherkin
Scenario: Panduan tampil
  Given frontend terbuka
  When user buka tab "Panduan"
  Then terlihat: cara buka folder manual, langkah Delete, daftar "jangan disentuh" (Installer, user data, junction), tips umur >14 hari
  And tidak ada exec/spawn yang terpanggil saat render panduan
```

---

## Acceptance Criteria

```
Rule: Whitelist scan (5 folder) — recursive, hidden/system included, NO symlink/junction follow
  ✓ Given %TEMP% berisi 1.234 file 2.5 GB, When GET /api/scan, Then entri ready + sizeHuman "2.5 GB"
  ✓ Given SoftwareDistribution\Download tidak ada, When GET /api/scan, Then not_found, 0, "0 B"
  ✓ Given junction ke D:\Projects\real-data, When GET /api/scan, Then sizeBytes tidak termasuk target
  ✓ Given junction loop A→B→A, When GET /api/scan, Then walk berhenti tanpa infinite loop
  ✓ Given folder kosong 0 file, When GET /api/scan, Then ready, 0, "0 B"

Rule: Read-only invariant
  ✓ Given app berjalan, When scan berlangsung, Then tidak ada fs.writeFile/unlink/rm/spawn/exec
  ✓ Given app berjalan, When dijalankan 2×, Then file sistem tidak berubah

Rule: Status per folder (tidak pernah 500 karena satu folder gagal)
  ✓ Given $Recycle.Bin butuh admin saat non-elevated, When GET /api/scan, Then access_denied + HTTP 200
  ✓ Given $Recycle.Bin\SID sub-access_denied, When GET /api/scan, Then parent = partial
  ✓ Given semua folder access_denied, When GET /api/scan, Then HTTP 200 + empty-state khusus
  ✓ Given semua folder not_found, When GET /api/scan, Then HTTP 200 + empty-state berbeda

Rule: Skip & continue (locked / vanished file)
  ✓ Given 1 file terkunci, When GET /api/scan, Then file di-skip, folder tetap ready
  ✓ Given file ENOENT di tengah walk, When GET /api/scan, Then skip, tidak crash/500
  ✗ Given skip > 10% fileCount, When GET /api/scan, Then folder status partial (bukan ready)

Rule: Elevation-safe target
  ✓ Given server elevated, When GET /api/scan, Then path = C:\Users\<logged-in>\AppData\Local\Temp

Rule: Refresh & race
  ✓ Given klik Refresh 10:05:00, When GET /api/scan, Then scannedAt = 2026-09-29T10:05:00+07:00 (ISO-8601 selesai, local offset)
  ✓ Given klik Refresh 3× cepat, When semua selesai, Then UI tampilkan request terakhir DIKIRIM, tanpa error konsol

Rule: Timeout 30s + loading state
  ✓ Given walk > 30s, When GET /api/scan, Then partial: true + scannedAt terisi + entry belum mulai = partial/0 + HTTP 200
  ✓ Given scan berjalan, When menunggu, Then tombol Refresh disabled, label "Memindai…"

Rule: sizeHuman format
  ✓ Given 0 byte, When render, Then "0 B"
  ✓ Given 2.5 GB (basis 1024), When render, Then "2.5 GB" (en locale, 1 desimal)

Rule: Auto-scan saat load
  ✓ Given halaman baru dibuka, When page load, Then auto-fetch /api/scan sekali

Rule: Top-level partial flag
  ✓ Given ≥1 entry partial, When GET /api/scan, Then top-level partial: true

Rule: Endpoint hapus / method salah
  ✓ Given POST /api/delete, When request, Then HTTP 404 {error:"..."}, tidak ada perubahan file
  ✗ Given DELETE /api/scan, When request, Then HTTP 405 {error:"..."}, tidak ada perubahan file
  ✓ Given method salah pada path unknown, When request, Then 404 menang atas 405

Rule: Bind & startup
  ✓ Given bind 127.0.0.1, When akses dari LAN, Then connection refused
  ✓ Given port 3456 dipakai, When start.bat, Then pesan jelas "Port 3456 in use", tanpa fallback diam-diam
  ✓ Given node tidak di PATH, When start.bat, Then pesan "Node.js not found", tanpa start parsial
  ✓ Given PORT di-override, When frontend fetch, Then same-origin relative path (/api/scan) otomatis ikut

Rule: Panduan
  ✓ Given frontend, When buka tab Panduan, Then teks statis terlihat, tanpa tombol Open-in-Explorer
```

**OPEN QUESTIONS (risks jika unresolved):**
- (sudah resolved — tidak ada blocking question tersisa)

**OUT-OF-SCOPE (untuk pocket-planning):**
- Hapus otomatis, scheduling, cache browser, Windows.old, Installer, user data folders
- Per-file detail listing, tombol Open-in-Explorer, umur file per-file backend
- Auth/HTTPS/bind 0.0.0.0/remote access/token

---

## Design Decision

**Chosen option:** Option A — `node:http` core-only (zero dependency)

**Summary:** Satu `server.js` memakai `http` + `fs` + `path` bawaan; router & static-file hand-rolled; recursive walk manual dengan `lstat` per entry untuk menjamin tidak mengikuti junction/symlink. Backend men-serve `public/` dari proses yang sama sehingga frontend bisa fetch same-origin relatif.

**Rejected options:**
- Option B (Express + vanilla): ditolak — hanya 1 endpoint GET, tanpa `npm install` lebih selaras dengan constraint "tanpa dependency berat" + audit read-only. (Ditawarkan karena build-vs-buy menuntut minimal 1 opsi library.)
- Option C (Express + React/Vue): ditolak — melanggar constraint "tanpa build step, vanilla HTML/JS".

**Key tradeoffs accepted:**
- Hand-rolled static handler (~60 baris boilerplate) — mitigasi path traversal: resolve + prefix check
- Tanpa keuntungan ekosistem Express (middleware, routing) — tidak dibutuhkan untuk 1 endpoint

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Threshold `partial` karena skip? | **Assumed:** skip > 10% `fileCount` folder | Terlalu sensitif → banyak `partial` palsu; terlalu longgar → status `ready` padahal banyak file gagal |
| Top-level `partial` flag? | **Assumed:** ≥1 entry `partial` → `partial: true` (grand total lower-bound) | Bila hanya timeout: user mungkin kira total sudah akurat |
| sizeHuman format? | **Assumed:** basis 1024, 1 desimal, en locale, `0` → `"0 B"` | Inkonsistensi antar tampilan bila berubah |
| scannedAt? | **Assumed:** selesai scan, local offset ISO-8601 penuh | Bila mulai-scan: user salah tahu kapan data diambil |
| Resolve %TEMP% saat elevated? | **Assumed:** registry `User Shell Folders\Local AppData` (read-only), fallback `%LOCALAPPDATA%\Temp` | Multi-session/remote-desktop: bisa resolve ke user yang salah |
| 30s cap scope? | **Assumed:** total 30s untuk 5 folder | Per-folder bisa 150s — total cap lebih ketat & user-friendly |
| PORT discovery frontend? | **Assumed:** backend serve frontend same-origin → relative fetch | Bila frontend di-serve beda origin: perlu build-time base URL (melanggar no-build) |
| Error body/bahasa? | **Assumed:** bahasa Indonesia, `{error:"..."}`, 404 > 405 precedence | Frontend yang expect English copy bisa mismatch |

---

## Implementation Notes

- **Read-only invariant harus ditegakkan di code review**: cari `fs.writeFile`, `fs.unlink`, `fs.rm`, `child_process.spawn/exec` di seluruh codebase — tidak boleh ada (kecuali registry lookup read-only via `execFile('reg', ['query', ...])` yang **tidak** menulis).
- **Recursive walk**: pakai `fs.lstat` (bukan `stat`) untuk deteksi symlink/junction; `readdir({withFileTypes:true})`.
- **Path traversal mitigation** pada static handler: `path.resolve` + check prefix root `public/`.
- **Auto-scan saat load** + tombol Refresh disabled selama in-flight (mencegah race yang tidak perlu).
- **Console log per folder gagal**: 1 baris (path + status + reason + elapsed ms), tanpa stacktrace ke response API.
- **`start.bat`**: cek `where node` dulu → pesan jelas bila tidak ada; cek port bebas → pesan jelas bila dipakai; set `PORT` default 3456 bila env kosong.

---

## Rollback Plan

- Aplikasi read-only, tanpa data/state persisten, tanpa dependency → rollback = hapus file proyek. Tidak ada yang perlu di-undo di sistem.
- Jika port sempat dipakai aplikasi lain di sesi sebelumnya → cukup tutup proses Node yang berjalan.
