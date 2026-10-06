# Cleanup Web Scanner

Aplikasi web lokal (read-only) untuk memindai folder temp/cache Windows, menampilkan jumlah file dan total ukuran per folder, serta panduan hapus aman manual.

**Tidak pernah menghapus file** — pengguna menghapus manual via File Explorer.

---

## Jalankan dengan Docker (Linux containers, Docker Desktop)

```bash
# 1) (Opsional) salin .env.example ke .env dan isi HOST_USER jika username
#    Windows Anda berbeda dari %USERNAME%.
# cp .env.example .env
# edit .env   # HOST_USER=muhamad.arwinwijaya

# 2) Build & jalankan
docker compose up --build -d

# 3) Buka di browser
# http://127.0.0.1:3456/
```

> **Catatan performa**: membaca folder lewat bind mount lebih lambat daripada
> native, dan folder `%LOCALAPPDATA%\Temp` bisa berisi ribuan file. Total scan
> karena itu diberi budget 3 menit (`SCAN_TIMEOUT_MS=180000`). Ubah di `.env`
> bila perlu. Folder yang belum selesai ditandai `partial` (bukan error).
>
> **Untuk pemindaian drive `D:` yang lengkap, jalankan native** (`node server.js`).
> Bind mount Docker ~4–5× lebih lambat; folder aplikasi besar seperti
> `D:\Program` (≈380 ribu file) bisa menghabiskan budget 3 menit dan berakhir
> `partial`. Native menyelesaikan seluruh scan `D:` dalam ~2 menit. Lihat
> *Jalankan native (Windows)* di bawah.

### Catatan penting
- Mount **read-only** seluruh `C:\` ke `/mnt/c` di container. Hanya 15 path `C:` dari total 18 whitelist yang dibaca lewat mount ini (3 lainnya dari `D:`).
- **Opsi multi-drive**: untuk memindai drive `D:` di container, tambahkan bind mount `D:\` → `/mnt/d:ro` ke `docker-compose.yml` (lihat *Multi-Drive Container Mounts* di bawah).
- Port hanya terikat di `127.0.0.1:3456` (tidak terekspos ke jaringan).
- Container berjalan sebagai user non-root (`node` uid 1000), filesystem rootfs read-only.
- Semua penghapusan manual via Explorer; aplikasi hanya menampilkan ringkasan + command siap salin.

---

## Jalankan native (Windows)

Jika Docker Desktop tidak jalan, gunakan jalur native.

```bash
node server.js
# http://127.0.0.1:3456/
```

> **Butuh** Node.js 20+ di PATH (disarankan Node 20 atau lebih baru).

### Rekomendasi: native untuk scan `D:` lengkap

Akses filesystem native jauh lebih cepat daripada bind mount Docker:

| Folder | Native | Docker bind mount |
|--------|--------|-------------------|
| `D:\Temp` | ~2 dtk | cepat |
| `D:\Program` (≈383 ribu file, 5.6 GB) | ~114 dtk | ~500 dtk (timeout) |
| `D:\Program Files` (≈11 ribu file) | ~4.5 dtk | belum tentu selesai |

- **Native**: seluruh scan `D:` selesai dalam ~2 menit (budget default 45 dtk per
  total, naikkan `SCAN_TIMEOUT_MS` bila perlu).
- **Docker**: `D:\Program` dan `D:\Program Files` (grup `app`) sering berakhir
  `partial` dengan `reason=timeout` karena bind mount lambat. Ini **bukan error**
  — nilainya tetap ditampilkan dengan penanda parsial.
- Bila butuh angka lengkap untuk folder aplikasi besar, gunakan native.

---

## Fitur
- **Tab Hasil Pindai**: kartu per-folder (18 folder whitelist) dikelompokkan Temp / Sistem / Log & Dump / Cache / Program, total keseluruhan.
- **Tab Panduan Hapus Aman**: panduan statis + klik kartu folder → modal dengan:
  - Detail folder & apa isinya
  - 5 langkah manual via File Explorer
  - Command PowerShell & CMD (siap salin)
  - Fitur Windows bawaan (Disk Cleanup, Settings)
  - Peringatan "Jangan disentuh"
- **Refresh (Pindai Ulang)**: race-safe, loading state, total parsial ditandai `≥`.

---

## Whitelist folder (18)

| Kategori | Folder | Path (Windows) |
|----------|--------|----------------|
| Temp | Local\Temp | `%LOCALAPPDATA%\Temp` (user) |
| Temp | Windows\Temp | `C:\Windows\Temp` |
| Sistem | Windows\Prefetch | `C:\Windows\Prefetch` |
| Sistem | $Recycle.Bin | `C:\$Recycle.Bin` |
| Sistem | SoftwareDistribution\Download | `C:\Windows\SoftwareDistribution\Download` |
| Log | Windows\Logs | `C:\Windows\Logs` |
| Log | Windows\Minidump | `C:\Windows\Minidump` |
| Log | LiveKernelReports | `C:\Windows\LiveKernelReports` |
| Log | WER\ReportQueue | `C:\ProgramData\Microsoft\Windows\WER\ReportQueue` |
| Log | WER\ReportArchive | `C:\ProgramData\Microsoft\Windows\WER\ReportArchive` |
| Cache | CrashDumps | `%LOCALAPPDATA%\CrashDumps` |
| Cache | INetCache | `%LOCALAPPDATA%\Microsoft\Windows\INetCache` |
| Cache | D3DSCache | `%LOCALAPPDATA%\D3DSCache` |
| Cache | NVIDIA\DXCache | `%LOCALAPPDATA%\NVIDIA\DXCache` |
| Cache | NVIDIA\GLCache | `%LOCALAPPDATA%\NVIDIA\GLCache` |
| Temp | D:\Temp | `D:\Temp` |
| Program | D:\Program | `D:\Program` |
| Program | D:\Program Files | `D:\Program Files` |

### Folder drive D: (`D:\Temp`, `D:\Program`, `D:\Program Files`)
- `D:\Temp` masuk kategori **Temp** dan ditampilkan seperti folder temp lain.
- `D:\Program` dan `D:\Program Files` masuk kategori **Program** (grup `app`).
- **Kebijakan tanpa hapus untuk folder program**: folder grup `app` bersifat observability-only. UI **tidak pernah** menampilkan command hapus untuk folder ini; panduan mengarahkan pengguna untuk uninstall lewat **Settings → Apps** (atau uninstaller resmi), bukan menghapus file/folder secara manual.
- Aplikasi tetap read-only: tidak ada penghapusan otomatis dalam bentuk apa pun.

---

## Multi-Drive Container Mounts

Di container Linux, setiap drive Windows diremap ke mount point-nya sendiri lewat `SCAN_HOST_MOUNT`:

```yaml
environment:
  SCAN_HOST_MOUNT: '{"c":"/mnt/c","d":"/mnt/d"}'
volumes:
  - type: bind
    source: C:\
    target: /mnt/c
    read_only: true
  # Opsional: hanya diperlukan bila host punya drive D:.
  - type: bind
    source: D:\
    target: /mnt/d
    read_only: true
```

- `SCAN_HOST_MOUNT` menerima objek/JSON `{"c":"/mnt/c","d":"/mnt/d"}`; path `C:\...` → `/mnt/c/...`, `D:\...` → `/mnt/d/...`.
- Bila hanya `C:` yang di-mount (string legacy `/mnt/c`), entri `D:` **tidak** ikut dipetakan ke `/mnt/c` — path aslinya dipertahankan.

### Host tanpa drive D: (D:-less)

- **Native Windows**: `node server.js` aman dijalankan tanpa drive `D:`. `scanAll()` menandai setiap entri `D:` sebagai `not_found` dan **tidak** menghentikan pemindaian drive `C:`. `not_found` bukan error dan tidak membuat hasil jadi `partial`.
- **Docker**: bind mount `D:\` hanya opsional. Pada host tanpa `D:`, jangan menambahkan mount `D:` — container tetap berjalan dan entri `D:` muncul sebagai `not_found`. Mount `D:\` yang wajib akan gagal di host tanpa drive `D:`, jadi pertahankan sebagai opsional.
- **Batasan**: container tidak bisa memindai `D:` bila drive tersebut tidak di-mount. Solusi untuk host D:-less adalah membiarkan entri `D:` `not_found` (atau memakai jalur native Windows).

---

## Konfigurasi Environment

| Var | Default | Deskripsi |
|-----|---------|-----------|
| `HOST` | `127.0.0.1` | Alamat bind server. Container: `0.0.0.0` (terbit ke host via port mapping). |
| `PORT` | `3456` | Port HTTP. |
| `SCAN_ROOTS` | *(auto)* | JSON array override whitelist: `[{name, path, group?, displayPath?}]`. |
| `SCAN_HOST_MOUNT` | *(none)* | Mount point host di container (mis. `/mnt/c`). Bila diset, path Windows otomatis diremap. |
| `SCAN_TIMEOUT_MS` | `45000` native / `180000` Docker | Total budget scan (dibagi semua folder). Bind mount lebih lambat, jadi Docker memakai 3 menit. Untuk scan `D:` lengkap, jalankan native. |

---

## Testing

```bash
npm test          # menjalankan seluruh test suite (node --test)
# atau tanpa npm:
node --test
```

---

## Read-only Invariant
- Tidak ada `fs.writeFile`, `fs.unlink`, `child_process.spawn`, `exec`, `explorer.exe` di source.
- Dockerfile & docker-compose.yml menjamin read-only rootfs, bind mount read-only, no-new-privileges.

---

## Struktur Proyek
```
├── server.js              # HTTP server + scanner logic
├── lib/
│   ├── format.js          # sizeHuman()
│   └── resolve-temp.js    # resolve %TEMP% via registry (read-only)
├── public/
│   ├── index.html         # UI (HTML/CSS)
│   └── app.js             # Frontend logic (vanilla JS)
├── tests/
│   ├── server.test.js
│   ├── public.test.js
│   ├── format.test.js
│   ├── resolve-temp.test.js
│   ├── read-only.test.js
│   └── scan-roots.test.js
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── .env.example
├── package.json         # zero runtime deps; npm test = node --test
├── .gitignore
└── README.md (this file)
```