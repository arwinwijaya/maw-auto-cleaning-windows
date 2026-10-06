# Pitch Exploration: safe-temp-cleanup
Date: 2026-09-29 | Project: auto-cleaning | Status: pitch-only

---

## Problem Statement
Drive C: kehabisan ruang karena file temp dan cache sistem menumpuk, dan pengguna membutuhkan satu file eksekusi manual yang menghapusnya tanpa pernah menyentuh data penting pengguna.

## Root Tension
Ingin pembersihan yang seluas mungkin (lebih banyak folder dibersihkan = lebih banyak ruang yang dibebaskan) berhadapan dengan fakta bahwa setiap folder tambahan yang ditambahkan ke whitelist meningkatkan risiko menghapus sesuatu yang ternyata dibutuhkan sistem atau pengguna. Pengaman harus seketat mungkin sementara utilitasnya harus tetap besar.

## Key Constraints
- Hanya path yang terdaftar eksplisit dalam whitelist yang boleh dihapus (pendekatan whitelist, bukan blacklist).
- Tidak boleh mengikuti junction / symlink / reparse point keluar dari folder temp — hapus link atau lewati, jangan traverse.
- `C:\Windows\Installer`, folder data pengguna (`Documents`, `Desktop`, `Downloads`, `OneDrive`), dan profil pengguna lain = area terlarang.
- Threshold umur file: hanya file lebih tua dari ambang tertentu (mis. 7 hari) yang dihapus.
- File yang terkunci/ sedang dipakai proses lain harus dilewati sebagai status "skipped", bukan menghentikan seluruh proses.
- Penghentian service `wuauserv` (dan `bits`) harus dijamin dipulihkan, termasuk saat proses gagal di tengah (blok `finally`).
- Mode dry-run tersedia dan menjadi default pemeriksaan; setiap penghapusan dicatat ke log (path, ukuran, status).
- Semua path wajib dikutip karena mengandung spasi; harus menangani long path (>260 karakter) dan nama file non-ASCII.
- Scope terkonfirmasi: temp dasar (`%TEMP%` user, `C:\Windows\Temp`) + cache sistem (Prefetch, Recycle Bin, `SoftwareDistribution\Download`).
- Cara kerja terkonfirmasi: manual satu klik — tanpa otomatisasi terjadwal.

---

## Brainstorming Methods Used

### Question Storming — deep
Key insights:
- Definisi "temp" bermakna ganda: file di `%TEMP%` yang sedang dipakai proses berjalan belum tentu disposable.
- Junction/symlink di dalam folder temp bisa membawa script keluar ke folder data asli — ini yang belum terjawab di awal.
- Keputusan umur file (0 vs 7 vs 30 hari) menentukan apakah installer/update yang sedang berjalan aman.
- Kegagalan karena file terkunci adalah keadaan normal, bukan error.
- "Aman" harus didefinisikan: bisa di-restore (Recycle Bin) atau permanen — ini keputusan desain.
- Status admin vs user biasa menentukan path mana yang benar-benar bisa diakses.
- Perbedaan krusial antara cache yang aman (`SoftwareDistribution\Download`) dan cache yang merusak (`C:\Windows\Installer`).
- Saat jalan otomatis, akuntabilitas atas kesalahan penghapusan jadi tidak jelas.

### First Principles Thinking — creative
Key insights:
- Data milik pengguna tidak pernah semestinya berada di folder yang bernama "Temp" — nama folder adalah kontrak disposisi, tapi kontrak ini berlaku per-konteks, bukan global.
- Prinsip inti: whitelist (hanya sentuh yang terverifikasi aman), bukan blacklist ("jangan sentuh X") — karena satu path terlupa pada blacklist sudah cukup untuk kehilangan data.
- Aman dari nol = idempoten + reversibel + observable (dry-run, hapus, log).
- Batas keras: tidak pernah menyentuh folder data pengguna atau profil lain.
- Reparse point diperlakukan sebagai tembok, bukan jalan.

### Six Thinking Hats — structured
Key insights:
- White (fakta): Windows tidak punya satu perintah pembersih tunggal; tiap folder punya pemilik dan aturan berbeda; penghapusan parsial karena file terkunci adalah normal.
- Red (emosi): ketakutan terbesar pengguna adalah "menghapus yang salah", bukan "gagal menghapus"; rasa aman lebih berharga daripada byte yang dibebaskan.
- Yellow (manfaat): C: jadi lega secara terukur dan berulang; puluhan GB bisa dibebaskan dari WU + temp.
- Black (risiko): menghapus `C:\Windows\Installer` merusak repair/uninstall; mengikuti junction menghapus data asli; hapus permanen tanpa jejak; lupa menyalakan kembali `wuauserv`; `%TEMP%` salah konteks antar-sesi; path >260 char; encoding non-ASCII.
- Green (ide): dry-run sebagai default; log CSV; ringkasan ruang yang dibebaskan; threshold umur; whitelist eksplisit; opsi ke Recycle Bin.
- Blue (proses): urutan benar = tetapkan whitelist → dry-run → validasi → eksekusi dengan threshold → log.

### Reverse Brainstorming — creative
Key insights (cara script menghancurkan data, untuk dibalik jadi pengaman):
- Menghapus `C:\Windows\Installer` karena "kelihatannya cache" → program tak bisa di-repair/uninstall.
- Mengikuti junction dari `%TEMP%` ke folder proyek → source code hilang.
- Menghapus semua tanpa threshold umur → installer/update di tengah jalan rusak.
- Variabel path tidak dikutip mengandung spasi → `del` salah sasaran ke direktori lain.
- Recycle Bin di-emptied permanen → file yang bisa dipulihkan hilang selamanya.
- Stop `wuauserv`/`bits` lalu tidak dinyalakan lagi → Windows Update mati diam-diam.
- Berjalan pada konteks SYSTEM → menghapus temp yang sedang dipakai service.
- Menganggap `Downloads` sebagai temp.
- Berjalan tanpa log → tidak ada jejak bila terjadi kesalahan.

---

## Advisor Synthesis
Advisor menegaskan bahwa keempat metode menghasilkan klaster pengaman yang sama dan konsisten (whitelist eksplisit, tidak men-junction, threshold umur, dry-run, log), sehingga kebutuhan inti sudah matang. Dua insight tertinggi nilai dari Reverse Brainstorming — berbahaya bila di-traverse reparse point, dan `C:\Windows\Installer` yang tampak seperti cache namun wajib dipertahankan — diminta agar dipastikan masuk sebagai Key Constraints, bukan sekadar catatan kaki. Cluster risiko vs kenyamanan menunjukkan penambahan folder scope selalu harus diimbangi kontrol yang lebih ketat (prefetch dan Windows Update memerlukan admin serta penanganan service).

---

## Spike Results
Spike tidak dijalankan: mode web search tidak tersedia dalam sesi ini dan direktori proyek masih kosong sehingga code scan tidak relevan. Tidak ada tool call spike yang dipakai.

**Unknown yang tidak terselesaikan:** daftar path Windows yang benar-benar aman untuk dihapus pada versi Windows pengguna, dan apakah pembersihan `SoftwareDistribution\Download` membutuhkan penghentian service `wuauserv`.
**Implikasi:** menjadi target Discovery pada pocket-grinding; whitelist pada Direction harus diverifikasi terhadap daftar tersebut sebelum implementasi.

---

## Approach Directions

### Direction A: Standalone PowerShell whitelist script
Satu file script `.ps1`/`.bat` yang berisi daftar path aman, flag dry-run, threshold umur file, dan penulisan log CSV.
+ Kontrol penuh, transparan, mudah ditinjau, tanpa dependensi eksternal.
− Pembuat script yang bertanggung jawab memastikan whitelist benar; penanganan service dan izin admin harus dikerjakan manual.

### Direction B: Wrapper atas alat bawaan Windows
Launcher tunggal yang menjalankan `cleanmgr`, Storage Sense, atau `DISM StartComponentCleanup`.
+ Paling aman — keamanan dan pengelolaan service sudah ditangani alat resmi Microsoft.
− Kontrol minim: tidak bisa memilih per-folder, output/log terbatas, sulit diaudit.

### Direction C: Hybrid — alat bawaan untuk cache sistem + whitelist sendiri untuk temp user
`DISM`/`cleanmgr` menangani cache sistem (Windows Update, component store), sedangkan script sendiri menangani `%TEMP%`, Prefetch, dan Recycle Bin dengan whitelist ketat.
+ Keseimbangan terbaik: tiap jenis cache ditangani dengan cara paling aman untuknya.
− Sedikit lebih kompleks karena menggabungkan dua mekanisme.

---

## Open Questions for pocket-grinding
- [ ] Path Windows mana saja yang benar-benar aman untuk dihapus pada versi Windows pengguna (daftar whitelist final)?
- [ ] Apakah pembersihan `SoftwareDistribution\Download` membutuhkan stop `wuauserv`/`bits`, atau cukup dilewati bila berjalan?
- [ ] Threshold umur file berapa hari yang tepat (7 / 14 / 30) untuk menyeimbangkan keamanan dan ruang yang dibebaskan?
- [ ] Apakah Prefetch dan Recycle Bin dimasukkan ke whitelist, dan apakah keduanya memerlukan izin admin?
- [ ] Bagaimana skrip menangani long path (>260 karakter) dan nama file non-ASCII pada PowerShell target Windows pengguna?
- [ ] Apakah file yang dihapus harus dipindahkan ke Recycle Bin (reversible) atau permanen dengan log CSV?

---

## Recommended Direction
Direction C — karena scope pengguna mencakup temp pengguna sekaligus cache sistem, dan arah ini menjaga batasan "jangan sentuh `C:\Windows\Installer` / jangan matikan Windows Update" tanpa memaksa menulis ulang logika pembersih milik Microsoft.

---

## Handoff Context (for pocket-grinding)
When pocket-grinding reads this doc:
- Start with this problem statement (Phase 1 context)
- Use Direction C as the working hypothesis for Phase 5 Design Proposals
- Treat Open Questions above as Phase 3 Discovery targets
- Do NOT treat Approach Directions as final architecture — validate through GWT first
