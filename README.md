# Disk Usage Analyzer

Aplikasi web lokal (100% read-only) untuk menganalisis penggunaan disk ala WinDirStat: hierarki folder dengan lazy-loading, kolom ukuran/% parent/% drive, treemap visualisasi, ringkasan ekstensi, dashboard file/folder terbesar, dan panduan pembersihan manual (copy-to-clipboard, tidak pernah dieksekusi aplikasi).

**Tidak pernah menghapus file, tidak ada endpoint tulis, tidak ada eksekusi shell** — semua pembersihan dilakukan manual oleh pengguna lewat File Explorer/terminal.

---

## Jalankan dengan Docker (Linux containers, Docker Desktop)

```bash
# 1) (Opsional) salin .env.example ke .env dan sesuaikan bila perlu.
# cp .env.example .env

# 2) Build & jalankan
docker compose up --build -d

# 3) Buka di browser
# http://127.0.0.1:3456/
```

> **Catatan performa**: membaca folder lewat bind mount lebih lambat daripada
> native. Total scan karena itu diberi budget (`SCAN_TIMEOUT_MS`, default 3 menit).
> Folder yang belum selesai ditandai `partial` (bukan error).
>
> **Untuk pemindaian drive yang lengkap, jalankan native** (`node server.js`).

### Keamanan
- Host drive di-mount **read-only** (`/mnt/c`, `/mnt/d`).
- **Tidak ada cleanup mounts, tidak ada volume writable.**
- Port hanya terikat di `127.0.0.1:3456` (tidak terekspos ke jaringan).
- Container berjalan sebagai user non-root (`node` uid 1000), filesystem rootfs read-only.
- Semua pembersihan manual; aplikasi hanya menampilkan ringkasan + command siap salin.

## Jalankan native (Windows)

```bash
node server.js
# atau dengan root custom:
# $env:SCAN_ROOTS='[{"name":"Drive D:","path":"D:\\","displayPath":"D:\\"}]'; node server.js
```

## API (semua read-only)

| Endpoint | Metode | Deskripsi |
|---|---|---|
| `/api/roots` | GET | Daftar drive/root yang tersedia |
| `/api/scans` | POST | Mulai pemindaian (`{rootId}`) |
| `/api/scans/:id/status` | GET | Status + total pemindaian |
| `/api/scans/:id/events` | GET | SSE: progress, done, cancelled, error |
| `/api/scans/:id/cancel` | POST | Batalkan pemindaian berjalan |
| `/api/scans/:id/tree/:nodeId` | GET | Anak langsung satu folder (lazy) |
| `/api/scans/:id/treemap?node=&depth=&limit=` | GET | Data treemap |
| `/api/scans/:id/summary` | GET | Total, ekstensi, top folder/file |
| `/api/guides` | GET | Daftar panduan pembersihan |
| `/api/guides/:id` | GET | Satu panduan (command hanya teks) |

Tidak ada `DELETE`, tidak ada `POST` selain scan/cancel, paths tidak pernah
diterima dari client — hanya node id yang diterbitkan server.

## Lingkungan

| Variabel | Default | Deskripsi |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind address (Docker: `0.0.0.0`) |
| `PORT` | `3456` | Port server |
| `SCAN_ROOTS` | — | JSON array `{name, path, displayPath?}` |
| `SCAN_HOST_MOUNT` | `/mnt/c` | Pemetaan drive Windows → mount container |
| `SCAN_TIMEOUT_MS` | `600000` | Budget total pemindaian |
