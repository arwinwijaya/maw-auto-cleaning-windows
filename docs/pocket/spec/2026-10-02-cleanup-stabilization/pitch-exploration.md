# Pitch Exploration: cleanup-stabilization
Date: 2026-10-02 | Project: Cleanup Web Scanner | Status: pitch-only

---

## Problem Statement
Tool berfungsi (46 test pass, Docker healthy) tetapi friksi tinggi untuk dipakai harian: Docker cold start + 60 s scan bind mount untuk 15 folder (hanya 3 yang pernah besar), tanpa riwayat/tren sehingga user manual bandingkan "sebelum/sesudah", dan friksi tinggi untuk diubah: tanpa `package.json`/`npm test`/`.git`, file `nul` liar, `node --test tests/` gagal.

## Root Tension
Keseimbangan antara *read-only promise + zero-dep purity* (contract test terjamin) vs *tooling ergonomics* (`package.json`, git, npm script) yang sebenarnya tidak melanggar promise — hanya menurunkan friction.

## Key Constraints
- Read-only invariant wajib terjaga (test contract `tests/read-only.test.js` enforce)
- Loopback-only (127.0.0.1), Windows 10 Pro + Docker Desktop Linux container
- ACL real: beberapa folder butuh Administrator → status `access_denied`/`partial` tetap ada
- Spike confirmed: menambah file root (`package.json`, `.gitignore`, `favicon.svg`) **tidak** memecah `read-only.test.js` (hanya scan `lib/**/*.js`, `public/**/*.{js,html}`, explicit `Dockerfile`, `docker-compose.yml`, `server.js`)
- `node --test` (tanpa arg) auto-detect test file di cwd → `npm test` = `"node --test"` cukup

---

## Brainstorming Methods Used

### Question Storming — deep
Key insights:
- Apa yang membuat tool "stabil" bagi satu orang? Tidak ada bug, atau tidak ada kejutan saat dipakai?
- Scan 60 detik untuk 15 folder: apakah user butuh *semua* folder, atau hanya 3 yang >100 MB?
- Kalau tool read-only dan tidak menghapus, siapa yang menyelesaikan pekerjaan sebenarnya — user, atau PowerShell yang disalin?
- Berapa kali user menekan "Pindai Ulang" dalam seminggu? Kalau <1×, apakah UI kompleks ini terpakai?
- Apakah user tahu hasil pemindaian sebelumnya?

### First Principles Thinking — creative
Key insights:
- Fundamental truth: tugas asli = "cari folder besar & aman dibuang, lalu buang". Presentasi (grup, pill, FAQ, tabel) adalah secondary.
- Informasi bernilai = (ukuran, tren, umur file). Sisanya statis.
- Penghapusan tetap manual → tool = observer, bukan actor. Nilai observer = membuat keputusan cepat.
- Node 24 sudah punya `node:test`, `fetch`, `--watch` bawaan. Zero-dep bukan cuma "aman", tapi "tidak ada yang perlu di-update".
- Asumsi diwarisi: "harus Docker" (padahal Node native jalan), "harus 15 folder" (angka spec, bukan data user), "harus tampil semua" (padahal yang penting yang besar).
- Jika mulai dari nol: satu halaman, tabel sort size desc, kolom "terakhir dibersihkan", satu tombol. ~200 baris, bukan ~1.500.

### Six Thinking Hats — structured
Key insights:
- White: Node 24, 0 deps, 46 test, tanpa `package.json`/`.git`, file `nul` liar, Docker-only, scan 180 s, loopback, `cache-control: no-store`, path-traversal guard, tanpa CSP.
- Red: UI cantik tapi berat; rasa "dashboard produk" untuk 1 user. Kecemasan: "kalau lupa cara jalan, masih bisa pakai?"
- Yellow: Panduan kaya = aman psikologis. Read-only invariant + test = kepercayaan tinggi.
- Black: Tanpa `package.json`/`npm test`, ergonomics rapuh. Tanpa git, tidak ada rollback. Docker-only = single point of failure. Scan lambat bind mount. `nul` file kotor. Tanpa CSP/favicon → 404 log bising.
- Green: Riwayat localStorage + delta. Sort by size. Filter "sembunyikan 0 B". Tombol "salin semua command". Native fallback. `npm test` script.
- Blue: Urutan: (1) rapikan fondasi (package.json, git, npm test), (2) perkecil friksi jalankan (native fallback), (3) tambah nilai informasi (tren/delta/sort), (4) baru polish UI.

### Reverse Brainstorming — creative
Key insights:
- Docker Desktop tidak jalan → tool mati, tanpa pesan, user bingung.
- Scan 60 detik tiap kali → user malas buka.
- Tampilkan 15 folder padahal 12 kosong → user menyapu 12 baris "0 B".
- Tidak ada riwayat → user lupa "kemarin 2,2 GB, sekarang berapa?".
- Tidak ada `npm test` → setiap perubahan ketik daftar 6 file test.
- Tidak ada git → satu edit buruk, tidak bisa kembali.
- File `nul` liar → siapa klon repo kaget.
- Panduan kaya tanpa tombol "sudah bersihkan" → user tidak tahu kapan pindai ulang.
- Modal tanpa focus-trap → Tab keluar modal (a11y).
- Tidak ada favicon → 404 log tiap load.
- Semua folder `partial` → user tidak tahu kenapa, hanya label.
- Read-only rootfs Docker → tidak ada tempat cache hasil scan antar-restart.

### Constraint Mapping — deep
Key insights:
- Real: read-only invariant, Windows + Docker Desktop Linux container, Node 24, loopback-only, ACL real.
- Warisan (bisa ditantang): "harus Docker saja" (pilihan user), "harus 15 folder" (angka spec), "zero-dep" (`package.json` tanpa dep tidak melanggar), "tanpa build step" (tetap bisa).
- Imagined (tidak nyata): "tidak bisa riwayat tanpa DB" (localStorage cukup), "tidak bisa sort tanpa backend ubah" (frontend saja), "tidak bisa npm test tanpa dep" (`package.json` + script cukup).
- Bottleneck utama: friction menjalankan (Docker cold start + 60 s) dan friction mengubah (tanpa package.json/git).

---

## Advisor Synthesis
Advisor curation mengkonfirmasi: nilai = kecepatan keputusan, bukan dashboard completeness. Docker-only adalah constraint warisan, bukan hukum. Dua friksi mendominasi: friksi menjalankan + friksi mengubah. Informasi hilang: hanya ukuran sesaat, tanpa tren/sort/filter. Read-only invariant + test adalah kekuatan. Semua 5 metode konvergen ke definisi yang sama: "tool pribadi stabil = maintenance minimal + jawaban instan". Setiap kegagalan Reverse Brainstorming memetakan 1:1 ke imagined constraint Constraint Mapping.

---

## Spike Results

**Unknown resolved:** Apakah menambah `package.json` / `.gitignore` / `favicon.svg` memecahkan `tests/read-only.test.js`?

**Finding:** **Tidak** — `collectSourceFiles()` hanya glob `lib/**/*.js` + `public/**/*.{js,html}` + explicit `['Dockerfile','docker-compose.yml','server.js']`. File root invisibel. Favicon di `public/` aman (asset guard hanya cek `child_process|spawn\(|exec\(|execFile\(` dan hardcoded host:port).

**Implication:** Foundation hygiene (package.json, git, npm test, favicon, CSP) aman dijalankan tanpa update test contract. Membuka jalan untuk Direction A.

---

## Approach Directions

### Direction A: Harden & Clarify (Recommended)
Rapikan fondasi (`package.json` zero-dep + `npm test`, `git init`, hapus `nul`, favicon, CSP) → tambah nilai informasi (sort ukuran desc, toggle "sembunyikan 0 B", localStorage riwayat + delta "turun 1,4 GB sejak 3 hari lalu") → polish kecil (focus-trap modal, tampilkan alasan `partial`). Semua frontend/root, test existing tidak perlu update, Docker tetap jalan.
+ Minimal blast radius; zero risk ke read-only invariant; "sudah jadi" tercapai tanpa arsitektur baru.
− Docker cold start + 60 s scan tetap ada (mitigasi: native fallback terdokumentasi).

### Direction B: Dual-runtime Polish
Direction A + native-first (`node server.js` documented + tested sebagai primary, Docker sebagai opsi), health UX (scan progress stream via SSE, quick-scan `?fast=1` hanya folder yang terakhir > threshold).
+ Docker mati tidak lagi mematikan tool; progress stream = percaya diri scan; quick-scan = jawaban <5 detik untuk folder besar.
− Lebih banyak perubahan `server.js` (progress stream, quick-scan logic), risiko regresi `partial` logic, scope lebih besar.

---

## Open Questions for pocket-grinding
- [ ] Apakah localStorage riwayat scan harus menyimpan semua 15 folder atau hanya yang >0 B?
- [ ] Format delta "turun X GB" — apakah dibandingkan ke scan sebelumnya saja, atau ke rata-rata 7 hari?
- [ ] `quick-scan` threshold: pakai size Bytes terakhir, atau fileCount, atau keduanya?
- [ ] Apakah favicon harus SVG inline di HTML atau file terpisah? (Asset guard tidak melarang keduanya)

---

## Recommended Direction
**Direction A** — karena foundation hygiene sudah menutupi 4 dari 5 top-pain-point, dan nilai informasi (sort/filter/history) sepenuhnya frontend → zero risk ke read-only invariant. Direction B bagus tapi blast radius lebih besar untuk tool "sudah jadi".

---

## Handoff Context (for pocket-grinding)
When pocket-grinding reads this doc:
- Start with this problem statement (Phase 1 context)
- Use Direction A as the working hypothesis for Phase 5 Design Proposals
- Treat Open Questions above as Phase 3 Discovery targets
- Do NOT treat Approach Directions as final architecture — validate through GWT first