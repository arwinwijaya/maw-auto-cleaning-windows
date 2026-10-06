(function () {
  'use strict';

  var UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

  var GROUP_ORDER = ['temp', 'system', 'logs', 'cache', 'app', 'other'];
  var GROUP_LABELS = {
    temp: 'Folder Temp',
    system: 'Sistem & Pembaruan Windows',
    logs: 'Log & Crash Dump',
    cache: 'Cache Aplikasi',
    app: 'Folder Program (Observasi Saja)',
    other: 'Lainnya',
  };

  var STATUS_LABELS = {
    ready: 'Siap',
    partial: 'Sebagian',
    access_denied: 'Akses ditolak',
    not_found: 'Tidak ditemukan',
  };

  // ---------------------------------------------------------------------------
  // Panduan Hapus Aman — content model
  // ---------------------------------------------------------------------------

  var RISK_LABELS = {
    aman: 'Aman',
    hati_hati: 'Hati-hati',
    lanjutan: 'Lanjutan',
  };

  var RISK_HINTS = {
    aman: 'Aman dibersihkan rutin. Windows/aplikasi akan membuat ulang bila diperlukan.',
    hati_hati: 'Boleh dibersihkan, tetapi periksa dulu isinya — mungkin masih Anda butuhkan.',
    lanjutan: 'Perlu hak Administrator atau langkah tambahan. Pahami dampaknya sebelum menghapus.',
  };

  var GUIDE_PILLARS = [
    ['Read-only', 'Aplikasi hanya membaca metadata folder. Tidak ada satu pun perintah hapus yang dijalankan otomatis.'],
    ['Manual', 'Semua penghapusan Anda lakukan sendiri lewat File Explorer atau command yang disalin dari panduan folder.'],
    ['Verifikasi', 'Setelah membersihkan, tekan "Pindai Ulang" untuk memastikan ukuran benar-benar turun.'],
  ];

  var SAFE_WORKFLOW = [
    ['Pindai dulu', 'Tekan "Pindai Ulang" untuk melihat folder mana yang benar-benar besar. Jangan menghapus berdasarkan dugaan.'],
    ['Mulai dari yang aman', 'Prioritaskan folder berlabel risiko "Aman". Tunda folder "Lanjutan" sampai Anda paham dampaknya.'],
    ['Tutup aplikasi', 'Tutup browser, game, dan aplikasi lain agar file tidak terkunci saat dihapus.'],
    ['Hapus manual', 'Klik kartu folder di tab "Hasil Pindai" untuk membuka panduan dan command yang bisa disalin.'],
    ['Lewati yang terkunci', 'Jika Windows menolak menghapus, lewati file itu. Jangan paksa dengan tool pihak ketiga.'],
    ['Verifikasi', 'Pindai ulang dan bandingkan ukuran sebelum dan sesudah.'],
  ];

  var GOLDEN_RULES = [
    ['C:\\Windows\\Installer', 'Cache MSI untuk repair/uninstall program. Menghapusnya bisa membuat aplikasi tidak bisa diperbaiki.'],
    ['Data pribadi', 'Documents, Desktop, Downloads, Pictures, Videos, Music, OneDrive, dan folder proyek.'],
    ['File sistem besar', 'Windows.old, pagefile.sys, hiberfil.sys, dan folder sistem di luar whitelist.'],
    ['Junction & symlink', 'Bisa menunjuk ke folder lain; menghapusnya berisiko menghapus data di lokasi target.'],
    ['Folder whitelist itu sendiri', 'Cukup kosongkan isinya — jangan hapus foldernya.'],
    ['Profil user lain', 'Folder milik akun lain bisa berisi data penting yang bukan milik Anda.'],
  ];

  var GUIDE_FAQ = [
    ['Apakah aman menghapus isi Local\\Temp?', 'Ya. Ini file sementara milik aplikasi user. File yang sedang dipakai akan ditolak Windows — itu normal.'],
    ['Kenapa sebagian file tidak bisa dihapus?', 'File itu sedang dibuka aplikasi atau layanan. Tutup aplikasinya, atau lewati saja; jangan paksa.'],
    ['Apakah game jadi lambat setelah menghapus cache shader?', 'Hanya sesaat. Cache shader dibangun ulang saat game pertama kali dijalankan kembali.'],
    ['Apakah perlu Run as Administrator?', 'Untuk folder sistem seperti Windows\\Temp, Windows\\Logs, dan Prefetch: ya. Folder milik user tidak perlu.'],
    ['Seberapa sering sebaiknya membersihkan?', 'Temp dan cache: kapan saja saat terasa besar. Log/dump: hanya bila tidak sedang menelusuri masalah.'],
    ['Apakah menghapus Recycle Bin itu aman?', 'Aman, tetapi file di dalamnya hilang permanen. Pastikan tidak ada yang masih ingin Anda pulihkan.'],
    ['Apakah aturan 14 hari itu penting?', 'File temp berumur lebih dari 14 hari hampir pasti sudah tidak dipakai. File yang sangat baru mungkin masih aktif.'],
  ];

  var GUIDE_TIPS = [
    'Aturan 14 hari: file temp yang berumur lebih dari 14 hari hampir pasti aman dibuang.',
    'Aktifkan Storage Sense (Settings > System > Storage) agar Windows membersihkan temp otomatis.',
    'Disk Cleanup (cleanmgr) dan "Cleanup recommendations" di Settings menangani sebagian besar folder ini tanpa command.',
    'Jalankan pemindaian ulang setelah membersihkan untuk memastikan ukuran benar-benar turun.',
    'Hindari cleaner pihak ketiga yang tidak jelas: banyak yang menyentuh area di luar whitelist ini.',
  ];

  // Canonical whitelist catalog: single source of truth for the guide table and
  // the per-folder modal. `risk` drives the color coding shown to the user.
  var FOLDER_CATALOG = [
    {
      name: 'Local\\Temp',
      group: 'temp',
      path: '%LOCALAPPDATA%\\Temp',
      risk: 'aman',
      admin: false,
      impact: 'File sementara aplikasi terbuang; aplikasi membuat ulang saat dibutuhkan.',
      regen: 'Terisi lagi dalam hitungan menit hingga hari.',
      what: 'File sementara milik aplikasi dan Windows untuk user yang sedang login. Aman dibersihkan, tetapi file yang sangat baru mungkin masih dipakai aplikasi aktif.',
      windows: [
        'Tekan Win+R, ketik %TEMP%, lalu Enter untuk membuka folder ini langsung.',
        'Disk Cleanup (cleanmgr) > centang "Temporary files" > OK.',
        'Settings > System > Storage > Temporary files.',
      ],
    },
    {
      name: 'Windows\\Temp',
      group: 'temp',
      path: 'C:\\Windows\\Temp',
      risk: 'aman',
      admin: true,
      impact: 'File sementara proses tingkat sistem terbuang; installer dan layanan Windows mengisinya lagi.',
      regen: 'Terisi ulang oleh installer dan layanan Windows.',
      what: 'File sementara tingkat sistem. Sebagian file memerlukan hak Administrator untuk dihapus.',
      windows: [
        'Disk Cleanup (cleanmgr) > "Temporary files". Jalankan sebagai Administrator.',
        'Settings > System > Storage > Temporary files.',
      ],
    },
    {
      name: 'Windows\\Prefetch',
      group: 'system',
      path: 'C:\\Windows\\Prefetch',
      risk: 'lanjutan',
      admin: true,
      impact: 'Startup aplikasi melambat sesaat karena Windows membangun ulang cache.',
      regen: 'Dibangun ulang otomatis saat aplikasi dibuka.',
      what: 'Cache percepatan startup aplikasi. Windows akan membuat ulang otomatis; menghapusnya hanya memperlambat startup sesaat.',
      windows: ['Biasanya tidak dibersihkan oleh Disk Cleanup; hapus manual atau lewat command.'],
    },
    {
      name: '$Recycle.Bin',
      group: 'system',
      path: 'C:\\$Recycle.Bin',
      risk: 'hati_hati',
      admin: false,
      impact: 'File yang Anda hapus hilang permanen dan tidak bisa dipulihkan.',
      regen: 'Terisi setiap kali Anda menghapus file.',
      what: 'Recycle Bin. Isinya file yang sudah Anda hapus tetapi belum permanen.',
      windows: [
        'Klik kanan ikon Recycle Bin di Desktop > Empty Recycle Bin (cara paling aman).',
        'Settings > System > Storage > Recycle Bin > Empty Recycle Bin.',
      ],
      note: 'Jangan hapus folder $Recycle.Bin itu sendiri, cukup kosongkan isinya.',
    },
    {
      name: 'SoftwareDistribution\\Download',
      group: 'system',
      path: 'C:\\Windows\\SoftwareDistribution\\Download',
      risk: 'hati_hati',
      admin: true,
      impact: 'Windows mengunduh ulang update yang belum terpasang — butuh koneksi internet.',
      regen: 'Terisi saat Windows Update mengunduh paket baru.',
      what: 'Cache unduhan Windows Update. Boleh dibersihkan; Windows akan mengunduh ulang bila diperlukan.',
      windows: [
        'Jalankan sebagai Administrator: hentikan layanan Windows Update (net stop wuauserv), kosongkan folder, lalu jalankan kembali (net start wuauserv).',
        'Settings > Windows Update > Troubleshoot dapat mereset cache ini otomatis.',
      ],
    },
    {
      name: 'Windows\\Logs',
      group: 'logs',
      path: 'C:\\Windows\\Logs',
      risk: 'hati_hati',
      admin: true,
      impact: 'Riwayat log hilang; sulit menelusuri masalah lama.',
      regen: 'Terisi ulang saat Windows mencatat aktivitas baru.',
      what: 'Log sistem Windows. Berguna untuk troubleshooting; hapus hanya bila tidak sedang mendiagnosis masalah.',
      windows: [
        'Disk Cleanup (cleanmgr) > "System error memory dump files".',
        'Event Viewer (eventvwr) > Windows Logs > Clear Log untuk log spesifik.',
      ],
    },
    {
      name: 'Windows\\Minidump',
      group: 'logs',
      path: 'C:\\Windows\\Minidump',
      risk: 'hati_hati',
      admin: true,
      impact: 'Bukti blue screen hilang; analisis crash lama tidak mungkin lagi.',
      regen: 'Hanya terisi saat terjadi crash baru.',
      what: 'Dump memori dari blue screen. Berguna untuk debug; aman dihapus bila tidak sedang menelusuri crash.',
      windows: ['Disk Cleanup (cleanmgr) > "System error memory dump files".'],
    },
    {
      name: 'LiveKernelReports',
      group: 'logs',
      path: 'C:\\Windows\\LiveKernelReports',
      risk: 'hati_hati',
      admin: true,
      impact: 'Laporan live-dump hilang; sulit menganalisis masalah driver.',
      regen: 'Terisi saat Windows mendeteksi masalah kernel.',
      what: 'Laporan kernel live-dump. Aman dihapus bila tidak sedang menelusuri masalah driver.',
      windows: ['Disk Cleanup (cleanmgr) > "System error memory dump files".'],
    },
    {
      name: 'WER\\ReportQueue',
      group: 'logs',
      path: 'C:\\ProgramData\\Microsoft\\Windows\\WER\\ReportQueue',
      risk: 'aman',
      admin: true,
      impact: 'Laporan crash yang menunggu dikirim terbuang.',
      regen: 'Terisi saat aplikasi crash.',
      what: 'Antrean laporan crash Windows Error Reporting.',
      windows: ['Disk Cleanup (cleanmgr) > "System error memory dump files".'],
    },
    {
      name: 'WER\\ReportArchive',
      group: 'logs',
      path: 'C:\\ProgramData\\Microsoft\\Windows\\WER\\ReportArchive',
      risk: 'aman',
      admin: true,
      impact: 'Arsip laporan crash lama terbuang.',
      regen: 'Terisi saat laporan crash diarsipkan.',
      what: 'Arsip laporan crash Windows Error Reporting.',
      windows: ['Disk Cleanup (cleanmgr) > "System error memory dump files".'],
    },
    {
      name: 'CrashDumps',
      group: 'cache',
      path: '%LOCALAPPDATA%\\CrashDumps',
      risk: 'aman',
      admin: false,
      impact: 'Dump aplikasi yang berhenti mendadak terbuang.',
      regen: 'Terisi saat aplikasi crash.',
      what: 'Dump aplikasi yang berhenti mendadak. Aman dihapus bila tidak sedang dianalisis.',
      windows: ['Disk Cleanup (cleanmgr) > "System error memory dump files".'],
    },
    {
      name: 'INetCache',
      group: 'cache',
      path: '%LOCALAPPDATA%\\Microsoft\\Windows\\INetCache',
      risk: 'aman',
      admin: false,
      impact: 'Cache internet terbuang; situs dimuat sedikit lebih lambat saat pertama dibuka.',
      regen: 'Terisi ulang saat browsing.',
      what: 'Cache internet WinINet (dipakai Internet Explorer dan sebagian aplikasi).',
      windows: ['Internet Options (inetcpl.cpl) > General > Delete > Temporary Internet files.'],
    },
    {
      name: 'D3DSCache',
      group: 'cache',
      path: '%LOCALAPPDATA%\\D3DSCache',
      risk: 'aman',
      admin: false,
      impact: 'Shader Direct3D dibangun ulang; game terasa lambat sesaat saat pertama dimuat.',
      regen: 'Dibangun ulang saat game/aplikasi Direct3D dijalankan.',
      what: 'Cache shader Direct3D. Aman dihapus; game/aplikasi akan membangun ulang cache.',
      windows: ['Tidak ada di Disk Cleanup; hapus manual atau lewat command.'],
    },
    {
      name: 'NVIDIA\\DXCache',
      group: 'cache',
      path: '%LOCALAPPDATA%\\NVIDIA\\DXCache',
      risk: 'aman',
      admin: false,
      impact: 'Shader DirectX dibangun ulang; frame pertama game bisa tersendat sesaat.',
      regen: 'Dibangun ulang saat game DirectX dijalankan.',
      what: 'Cache shader DirectX milik driver NVIDIA. Aman dihapus; akan dibuat ulang saat game dijalankan.',
      windows: ['NVIDIA Control Panel > Manage 3D settings (tidak selalu ada opsi bersihkan); cara termudah lewat command.'],
    },
    {
      name: 'NVIDIA\\GLCache',
      group: 'cache',
      path: '%LOCALAPPDATA%\\NVIDIA\\GLCache',
      risk: 'aman',
      admin: false,
      impact: 'Shader OpenGL dibangun ulang; aplikasi terasa lambat sesaat.',
      regen: 'Dibangun ulang saat aplikasi OpenGL dijalankan.',
      what: 'Cache shader OpenGL milik driver NVIDIA. Aman dihapus; akan dibuat ulang saat aplikasi dijalankan.',
      windows: ['Cara termudah lewat command atau hapus manual di File Explorer.'],
    },
    {
      name: 'D:\\Program',
      group: 'app',
      path: 'D:\\Program',
      risk: 'lanjutan',
      admin: true,
      observationOnly: true,
      impact: 'Aplikasi bisa rusak atau tidak bisa dijalankan/di-repair. Jangan hapus foldernya.',
      regen: 'Tidak terisi ulang otomatis — hanya installer/aplikasi yang mengisinya.',
      what: 'Folder instalasi program di drive D:. Ini bukan folder cache sementara: isinya milik aplikasi yang terpasang. Untuk membebaskan ruang, uninstall aplikasi lewat Windows Settings, bukan dengan menghapus file.',
      windows: [
        'Buka Settings > Apps > Installed apps.',
        'Cari aplikasi yang terpasang di D:\\Program, lalu pilih Uninstall.',
        'Ikuti wizard uninstaller. Setelah selesai, tekan "Pindai Ulang" untuk melihat perubahannya.',
      ],
      note: 'Observasi saja: jangan hapus isi folder ini secara manual. Gunakan Uninstall dari Windows Settings agar registry dan sisa file ikut dibersihkan dengan benar.',
    },
    {
      name: 'D:\\Program Files',
      group: 'app',
      path: 'D:\\Program Files',
      risk: 'lanjutan',
      admin: true,
      observationOnly: true,
      impact: 'Aplikasi bisa rusak atau tidak bisa dijalankan/di-repair. Jangan hapus foldernya.',
      regen: 'Tidak terisi ulang otomatis — hanya installer/aplikasi yang mengisinya.',
      what: 'Folder instalasi program 64-bit di drive D:. Ini bukan folder cache sementara: isinya milik aplikasi yang terpasang. Untuk membebaskan ruang, uninstall aplikasi lewat Windows Settings, bukan dengan menghapus file.',
      windows: [
        'Buka Settings > Apps > Installed apps.',
        'Cari aplikasi yang terpasang di D:\\Program Files, lalu pilih Uninstall.',
        'Ikuti wizard uninstaller. Setelah selesai, tekan "Pindai Ulang" untuk melihat perubahannya.',
      ],
      note: 'Observasi saja: jangan hapus isi folder ini secara manual. Gunakan Uninstall dari Windows Settings agar registry dan sisa file ikut dibersihkan dengan benar.',
    },
  ];

  var FOLDER_BY_NAME = {};
  FOLDER_CATALOG.forEach(function (folder) {
    FOLDER_BY_NAME[folder.name] = folder;
  });

  var GROUP_FALLBACK = {
    temp: {
      what: 'Folder file sementara. Aman dibersihkan; file yang sedang dipakai aplikasi akan dilewati Windows.',
      windows: ['Disk Cleanup (cleanmgr) > "Temporary files".'],
      risk: 'aman',
      impact: 'File sementara terbuang; aplikasi membuat ulang saat dibutuhkan.',
      regen: 'Terisi ulang otomatis.',
    },
    system: {
      what: 'Folder cache/sistem Windows. Sebagian memerlukan hak Administrator.',
      windows: ['Disk Cleanup (cleanmgr) dan Settings > System > Storage.'],
      admin: true,
      risk: 'hati_hati',
      impact: 'Berpengaruh ke sistem; pahami dulu sebelum menghapus.',
      regen: 'Bervariasi tergantung folder.',
    },
    logs: {
      what: 'Log dan laporan crash. Berguna untuk troubleshooting; hapus bila tidak sedang mendiagnosis masalah.',
      windows: ['Disk Cleanup (cleanmgr) > "System error memory dump files".'],
      admin: true,
      risk: 'hati_hati',
      impact: 'Riwayat troubleshooting hilang.',
      regen: 'Terisi saat ada kejadian baru.',
    },
    cache: {
      what: 'Cache aplikasi. Aman dihapus; aplikasi akan membangun ulang cache saat dijalankan.',
      windows: ['Disk Cleanup (cleanmgr) > "Temporary files".'],
      risk: 'aman',
      impact: 'Cache dibangun ulang; aplikasi terasa lambat sesaat.',
      regen: 'Terisi ulang saat aplikasi dijalankan.',
    },
    app: {
      observationOnly: true,
      what: 'Folder instalasi program. Ini bukan cache sementara: isinya milik aplikasi yang terpasang. Untuk membebaskan ruang, uninstall aplikasi lewat Windows Settings, bukan dengan menghapus file.',
      windows: [
        'Buka Settings > Apps > Installed apps.',
        'Pilih aplikasi yang ingin dihapus, lalu klik Uninstall.',
      ],
      admin: true,
      risk: 'lanjutan',
      impact: 'Aplikasi bisa rusak bila file dihapus manual. Jangan hapus foldernya.',
      regen: 'Tidak terisi ulang otomatis.',
      note: 'Observasi saja: jangan hapus isi folder ini secara manual. Gunakan Uninstall dari Windows Settings.',
    },
    other: {
      what: 'Folder cache sementara. Periksa isinya sebelum menghapus.',
      windows: ['Disk Cleanup (cleanmgr).'],
      risk: 'hati_hati',
      impact: 'Periksa dulu isinya sebelum menghapus.',
      regen: 'Bervariasi.',
    },
  };

  var GLOBAL_COMMANDS = [
    {
      label: 'PowerShell (Administrator)',
      command: [
        '$roots = @(',
        '  "$env:LOCALAPPDATA\\Temp",',
        '  "C:\\Windows\\Temp",',
        '  "C:\\Windows\\Prefetch",',
        '  "C:\\$Recycle.Bin",',
        '  "C:\\Windows\\SoftwareDistribution\\Download",',
        '  "C:\\Windows\\Logs",',
        '  "C:\\Windows\\Minidump",',
        '  "C:\\Windows\\LiveKernelReports",',
        '  "C:\\ProgramData\\Microsoft\\Windows\\WER\\ReportQueue",',
        '  "C:\\ProgramData\\Microsoft\\Windows\\WER\\ReportArchive",',
        '  "$env:LOCALAPPDATA\\CrashDumps",',
        '  "$env:LOCALAPPDATA\\Microsoft\\Windows\\INetCache",',
        '  "$env:LOCALAPPDATA\\D3DSCache",',
        '  "$env:LOCALAPPDATA\\NVIDIA\\DXCache",',
        '  "$env:LOCALAPPDATA\\NVIDIA\\GLCache"',
        ')',
        'foreach ($p in $roots) {',
        '  if (Test-Path -LiteralPath $p) {',
        '    Get-ChildItem -LiteralPath $p -Force -ErrorAction SilentlyContinue |',
        '      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue',
        '  }',
        '}',
        'Write-Host "Selesai. Jalankan Pindai Ulang untuk verifikasi."',
      ].join('\n'),
      note: 'Menghapus ISI setiap folder whitelist yang ada. File yang terkunci dilewati. Jalankan di PowerShell sebagai Administrator.',
    },
  ];

  var state = {
    nextRequestId: 0,
    latestSentRequestId: 0,
    inFlight: 0,
    originalRefreshLabel: 'Pindai Ulang',
    lastScanData: null,
  };

  // In-memory preferences. Persistence (versioned key) is layered on later;
  // the defaults below are the single source of truth for both.
  var PREFS_STORAGE_KEY = 'cleanupScanner.prefs.v1';

  function getPrefsStorage() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
    } catch (error) {
      return null;
    }
    return null;
  }

  function normalizePrefs(raw) {
    var source = raw && typeof raw === 'object' ? raw : {};
    return {
      sortBySizeDesc: source.sortBySizeDesc !== false,
      hideZero: source.hideZero === true,
      hideNotFound: source.hideNotFound !== false,
    };
  }

  function loadPrefs() {
    var storage = getPrefsStorage();
    if (!storage) return normalizePrefs(null);
    try {
      var stored = storage.getItem(PREFS_STORAGE_KEY);
      if (!stored) return normalizePrefs(null);
      return normalizePrefs(JSON.parse(stored));
    } catch (error) {
      return normalizePrefs(null);
    }
  }

  function savePrefs() {
    var storage = getPrefsStorage();
    if (!storage) return;
    try {
      storage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    } catch (error) {
      // Quota or unavailable storage: preferences stay in-memory for this session.
    }
  }

  var prefs = loadPrefs();

  // ---------------------------------------------------------------------------
  // Scan history + delta baseline (localStorage only — never sent to server)
  // ---------------------------------------------------------------------------

  var HISTORY_STORAGE_KEY = 'cleanupScanner.history.v1';
  var CLEANED_STORAGE_KEY = 'cleanupScanner.lastCleanedAt';
  var HISTORY_LIMIT = 20;

  function loadHistory() {
    var storage = getPrefsStorage();
    if (!storage) return [];
    try {
      var stored = storage.getItem(HISTORY_STORAGE_KEY);
      if (!stored) return [];
      var parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function saveHistory(history) {
    var storage = getPrefsStorage();
    if (!storage) return;
    try {
      storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch (error) {
      // Quota or unavailable storage: history stays in-memory for this session.
    }
  }

  function snapshotFromScan(data) {
    var entries = Array.isArray(data && data.entries) ? data.entries : [];
    var meta = {};
    var totalBytes = 0;
    entries.forEach(function (entry) {
      if (!entry || !entry.name) return;
      var sizeBytes = Number(entry.sizeBytes) || 0;
      totalBytes += sizeBytes;
      meta[entry.name] = {
        sizeBytes: sizeBytes,
        fileCount: Number(entry.fileCount) || 0,
      };
    });
    return {
      scannedAt: (data && data.scannedAt) || new Date().toISOString(),
      totalBytes: totalBytes,
      partial: Boolean(data && data.partial),
      entries: meta,
    };
  }

  // Push a snapshot of a completed scan, keeping the newest HISTORY_LIMIT
  // entries (FIFO: the oldest is dropped once the cap is reached).
  function recordScan(data) {
    var history = loadHistory();
    history.push(snapshotFromScan(data));
    if (history.length > HISTORY_LIMIT) {
      history = history.slice(history.length - HISTORY_LIMIT);
    }
    saveHistory(history);
  }

  // Walk history backwards for the newest non-partial snapshot that is not the
  // current scan itself. Partial scans are unusable as a baseline.
  function findDeltaBaseline(data) {
    var history = loadHistory();
    var currentAt = data && data.scannedAt;
    for (var i = history.length - 1; i >= 0; i -= 1) {
      var candidate = history[i];
      if (!candidate || candidate.partial) continue;
      if (currentAt && candidate.scannedAt === currentAt) continue;
      return candidate;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Mark cleaned (local annotation) + relative time
  // ---------------------------------------------------------------------------

  function loadLastCleanedAt() {
    var storage = getPrefsStorage();
    if (!storage) return null;
    try {
      return storage.getItem(CLEANED_STORAGE_KEY);
    } catch (error) {
      return null;
    }
  }

  function saveLastCleanedAt(iso) {
    var storage = getPrefsStorage();
    if (!storage) return;
    try {
      storage.setItem(CLEANED_STORAGE_KEY, iso);
    } catch (error) {
      // Quota or unavailable storage: annotation stays in-memory for this session.
    }
  }

  function relativeTime(iso, nowMs) {
    var then = Date.parse(iso);
    if (isNaN(then)) return '';
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    var diff = now - then;
    if (diff < 0) diff = 0;
    var MINUTE = 60000;
    var HOUR = 3600000;
    var DAY = 86400000;
    if (diff < MINUTE) return 'baru saja';
    if (diff < HOUR) return Math.floor(diff / MINUTE) + ' menit lalu';
    if (diff < DAY) return Math.floor(diff / HOUR) + ' jam lalu';
    return Math.floor(diff / DAY) + ' hari lalu';
  }

  function sizeHumanId(sizeBytes) {
    return sizeHuman(sizeBytes).replace('.', ',');
  }

  function renderCleanedStatus() {
    if (!els.cleanedStatus) return;
    var iso = loadLastCleanedAt();
    els.cleanedStatus.textContent = iso ? 'Terakhir dibersihkan: ' + relativeTime(iso) : '';
  }

  function markCleaned() {
    saveLastCleanedAt(new Date().toISOString());
    renderCleanedStatus();
  }

  var els = {};
  var lastFocused = null;

  function sizeHuman(sizeBytes) {
    if (!sizeBytes) return '0 B';
    var value = sizeBytes;
    var unitIndex = 0;
    while (value >= 1024 && unitIndex < UNITS.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    if (unitIndex === 0) return String(value) + ' ' + UNITS[unitIndex];
    return value.toFixed(1) + ' ' + UNITS[unitIndex];
  }

  function formatCount(count) {
    var value = Number(count) || 0;
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function getElements() {
    els.refreshButton = document.getElementById('refresh-button');
    els.scanStatus = document.getElementById('scan-status');
    els.resultsPanel = document.getElementById('results-panel');
    els.guidePanel = document.getElementById('guide-panel');
    els.resultsContent = document.getElementById('results-content');
    els.grandTotal = document.getElementById('grand-total');
    els.emptyState = document.getElementById('empty-state');
    els.sortToggle = document.getElementById('sort-toggle');
    els.hideZeroToggle = document.getElementById('hide-zero-toggle');
    els.hiddenChip = document.getElementById('hidden-chip');
    els.tabResults = document.getElementById('tab-results');
    els.tabGuide = document.getElementById('tab-guide');
    els.modal = document.getElementById('folder-modal');
    els.modalBackdrop = document.getElementById('modal-backdrop');
    els.modalTitle = document.getElementById('modal-title');
    els.modalBody = document.getElementById('modal-body');
    els.modalClose = document.getElementById('modal-close');
    els.delta = document.getElementById('scan-delta');
    els.markCleanedButton = document.getElementById('mark-cleaned-button');
    els.cleanedStatus = document.getElementById('cleaned-status');
    els.tabCleanup = document.getElementById('tab-cleanup');
    els.cleanupPanel = document.getElementById('cleanup-panel');
    els.cleanupTargets = document.getElementById('cleanup-targets');
    els.cleanupPreviewButton = document.getElementById('cleanup-preview-button');
    els.cleanupPreview = document.getElementById('cleanup-preview');
    els.cleanupConfirmWrap = document.getElementById('cleanup-confirm-wrap');
    els.cleanupConfirmCheck = document.getElementById('cleanup-confirm-check');
    els.cleanupStartButton = document.getElementById('cleanup-start-button');
    els.cleanupProgress = document.getElementById('cleanup-progress');
    els.cleanupProgressLabel = document.getElementById('cleanup-progress-label');
    els.cleanupProgressBar = document.getElementById('cleanup-progress-bar');
    els.cleanupProgressDetail = document.getElementById('cleanup-progress-detail');
    els.cleanupCancelButton = document.getElementById('cleanup-cancel-button');
    els.cleanupResult = document.getElementById('cleanup-result');
  }

  function clearElement(element) {
    if (!element) return;
    // Setting textContent clears all child nodes. Do not touch element.children:
    // in browsers it is a read-only HTMLCollection and assigning to its length
    // throws a TypeError in strict mode, which would abort init() before the
    // refresh button listener is attached.
    element.textContent = '';
  }

  function createEl(tagName, className, text) {
    var element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = text;
    return element;
  }

  function append(parent, child) {
    if (!parent || !child) return child;
    parent.appendChild(child);
    return child;
  }

  function setAttr(element, name, value) {
    if (element && typeof element.setAttribute === 'function') {
      element.setAttribute(name, value);
    }
  }

  function setLoading(isLoading) {
    if (!els.refreshButton) return;
    if (isLoading) {
      els.refreshButton.disabled = true;
      els.refreshButton.className = 'is-loading';
      els.refreshButton.textContent = 'Memindai…';
      if (els.scanStatus) els.scanStatus.textContent = 'Memindai folder sementara…';
      return;
    }
    els.refreshButton.disabled = false;
    els.refreshButton.className = '';
    els.refreshButton.textContent = state.originalRefreshLabel;
  }

  function allEntriesHaveStatus(entries, status) {
    return entries.length > 0 && entries.every(function (entry) {
      return entry.status === status;
    });
  }

  function renderGuide() {
    if (!els.guidePanel) return;
    clearElement(els.guidePanel);

    var wrap = append(els.guidePanel, createEl('div', 'guide-wrap'));
    append(wrap, createEl('h1', 'guide-main-title', 'Panduan Hapus Aman'));

    // 1. Prinsip Dasar
    var intro = guideSection(wrap, 'Prinsip Dasar', 'Tiga aturan yang membuat alat ini tetap aman.');
    var pillars = append(intro, createEl('div', 'pillars'));
    GUIDE_PILLARS.forEach(function (p) {
      var card = append(pillars, createEl('div', 'pillar'));
      append(card, createEl('div', 'pillar-title', p[0]));
      append(card, createEl('p', 'pillar-text', p[1]));
    });

    // 2. Alur Kerja Aman
    var flow = guideSection(wrap, 'Alur Kerja Aman', 'Ikuti urutan ini setiap kali membersihkan.');
    var steps = append(flow, createEl('ol', 'flow-list'));
    SAFE_WORKFLOW.forEach(function (s) {
      var li = append(steps, createEl('li'));
      append(li, createEl('b', null, s[0]));
      append(li, createEl('span', null, ' — ' + s[1]));
    });

    // 3. Ringkasan Folder Whitelist
    var summary = guideSection(wrap, 'Ringkasan Folder Whitelist', 'Klik baris untuk membuka panduan & command folder tersebut.');
    renderFolderTable(summary);

    // 4. Jangan Disentuh
    var golden = guideSection(wrap, 'Jangan Disentuh', 'Area yang berisiko tinggi — hindari meski terlihat besar.');
    var rules = append(golden, createEl('ul', 'rule-list'));
    GOLDEN_RULES.forEach(function (r) {
      var li = append(rules, createEl('li'));
      append(li, createEl('b', null, r[0]));
      append(li, createEl('span', null, ' — ' + r[1]));
    });

    // 5. Command Global
    var cmds = guideSection(wrap, 'Command Sekaligus (Opsional)', 'Menghapus ISI semua folder whitelist dalam satu kali jalan. Jalankan hanya setelah paham risikonya.');
    GLOBAL_COMMANDS.forEach(function (item) { addCommandBlock(cmds, item); });

    // 6. FAQ
    var faq = guideSection(wrap, 'Pertanyaan Umum', '');
    var faqList = append(faq, createEl('div', 'faq'));
    GUIDE_FAQ.forEach(function (pair) {
      var item = append(faqList, createEl('details', 'faq-item'));
      append(item, createEl('summary', null, pair[0]));
      append(item, createEl('p', 'faq-answer', pair[1]));
    });

    // 7. Tips
    var tips = guideSection(wrap, 'Tips', '');
    var tipList = append(tips, createEl('ul', 'tip-list'));
    GUIDE_TIPS.forEach(function (t) { append(tipList, createEl('li', null, t)); });
  }

  function guideSection(parent, title, subtitle) {
    var section = append(parent, createEl('section', 'guide-section'));
    append(section, createEl('h2', 'guide-section-title', title));
    if (subtitle) append(section, createEl('p', 'guide-section-sub', subtitle));
    return section;
  }

  function renderFolderTable(container) {
    var wrap = append(container, createEl('div', 'guide-table-wrap'));
    var table = append(wrap, createEl('table', 'guide-table'));
    var thead = append(table, createEl('thead'));
    var headRow = append(thead, createEl('tr'));
    ['Folder', 'Kategori', 'Risiko', 'Dampak bila dihapus', 'Admin'].forEach(function (label) {
      append(headRow, createEl('th', null, label));
    });
    var tbody = append(table, createEl('tbody'));
    GROUP_ORDER.forEach(function (groupKey) {
      FOLDER_CATALOG.filter(function (f) { return f.group === groupKey; }).forEach(function (folder) {
        var row = append(tbody, createEl('tr', 'guide-row'));
        row.tabIndex = 0;
        setAttr(row, 'role', 'button');
        setAttr(row, 'aria-label', 'Buka panduan ' + folder.name);
        append(row, createEl('td', 'cell-name', folder.name));
        append(row, createEl('td', null, GROUP_LABELS[groupKey] || groupKey));
        var riskCell = append(row, createEl('td'));
        append(riskCell, createEl('span', 'risk-pill risk-' + folder.risk, RISK_LABELS[folder.risk]));
        append(row, createEl('td', 'cell-impact', folder.impact));
        append(row, createEl('td', null, folder.admin ? 'Ya' : 'Tidak'));
        row.addEventListener('click', function () { openCatalogModal(folder); });
        row.addEventListener('keydown', function (event) {
          var key = event && event.key;
          if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
            if (typeof event.preventDefault === 'function') event.preventDefault();
            openCatalogModal(folder);
          }
        });
      });
    });
  }

  function openCatalogModal(folder) {
    openFolderModal({
      name: folder.name,
      path: folder.path,
      group: folder.group,
      fileCount: null,
      sizeBytes: null,
      sizeHuman: null,
      status: null,
    });
  }

  function statusBadge(status) {
    var label = STATUS_LABELS[status] || status;
    return createEl('span', 'badge badge-' + status, label);
  }

  // ---------------------------------------------------------------------------
  // Per-folder safe-deletion guide
  // ---------------------------------------------------------------------------

  function resolveFolderGuide(entry) {
    var specific = FOLDER_BY_NAME[entry.name];
    var fallback = GROUP_FALLBACK[entry.group] || GROUP_FALLBACK.other;
    var base = specific || fallback;
    return {
      what: base.what,
      windows: base.windows || fallback.windows || [],
      note: base.note || '',
      admin: Boolean(base.admin || fallback.admin),
      risk: base.risk || fallback.risk || 'hati_hati',
      impact: base.impact || '',
      regen: base.regen || '',
      observationOnly: Boolean(base.observationOnly || fallback.observationOnly),
    };
  }

  function psQuote(pathValue) {
    // PowerShell single-quoted literal: escape an embedded quote by doubling it.
    return "'" + String(pathValue).replace(/'/g, "''") + "'";
  }

  function buildCommands(entry) {
    var pathValue = entry.path || '';
    return [
      {
        label: 'PowerShell',
        command: 'Get-ChildItem -LiteralPath ' + psQuote(pathValue)
          + ' -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue',
        note: 'Hapus ISI folder dan pertahankan foldernya. File yang terkunci akan dilewati.',
      },
      {
        label: 'CMD',
        command: 'del /f /s /q "' + pathValue + '\\*" & for /d %x in ("' + pathValue
          + '\\*") do @rd /s /q "%x"',
        note: 'Di dalam file .bat, ganti %x menjadi %%x.',
      },
    ];
  }

  function buildFolderGuide(entry) {
    var detail = resolveFolderGuide(entry);
    var isObservationOnly = detail.observationOnly;
    return {
      name: entry.name,
      path: entry.path,
      status: entry.status,
      sizeHuman: entry.sizeHuman || (entry.sizeBytes != null ? sizeHuman(entry.sizeBytes) : null),
      fileCount: entry.fileCount,
      hasScanData: entry.fileCount != null && entry.sizeBytes != null,
      detail: detail,
      steps: isObservationOnly
        ? [
            'Folder ini hanya untuk observasi ukuran — jangan hapus isinya.',
            'Untuk membuang aplikasi, buka Windows Settings > Apps > Installed apps.',
            'Pilih aplikasi yang ingin dihapus, lalu klik Uninstall.',
            'Ikuti wizard uninstaller hingga selesai.',
            'Tekan "Pindai Ulang" untuk memverifikasi ukuran setelah uninstall.',
          ]
        : [
            'Tutup aplikasi yang sedang memakai folder ini bila memungkinkan.',
            'Buka File Explorer (Win+E), tempel path di bawah ke address bar, lalu Enter.',
            'Pilih isi folder yang ingin dibersihkan, lalu tekan Delete (atau Shift+Delete untuk permanen).',
            'Lewati file yang ditolak Windows karena sedang dipakai — jangan paksa.',
            'Jalankan ulang "Pindai Ulang" untuk melihat sisa ukuran.',
          ],
      commands: isObservationOnly ? [] : buildCommands(entry),
    };
  }

  function addCommandBlock(parent, item) {
    var section = append(parent, createEl('div', 'modal-section'));
    append(section, createEl('h3', null, 'Command ' + item.label));

    var wrap = append(section, createEl('div', 'code-wrap'));
    var code = append(wrap, createEl('pre', 'code-block', item.command));

    var button = createEl('button', 'copy-button', 'Salin');
    button.type = 'button';
    setAttr(button, 'aria-label', 'Salin command ' + item.label);
    button.addEventListener('click', function () {
      copyText(item.command).then(
        function () { button.textContent = 'Tersalin'; },
        function () { button.textContent = 'Gagal'; },
      );
      if (code && typeof code.select === 'function') code.select();
    });
    append(wrap, button);

    if (item.note) append(section, createEl('p', 'modal-note', item.note));
  }

  function copyText(text) {
    if (typeof navigator !== 'undefined' && navigator && navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return Promise.reject(new Error('Clipboard tidak tersedia'));
  }

  function renderFolderModal(entry) {
    if (!els.modalTitle || !els.modalBody) return;
    var guide = buildFolderGuide(entry);

    els.modalTitle.textContent = guide.name || '(tanpa nama)';
    clearElement(els.modalBody);

    var meta = append(els.modalBody, createEl('div', 'modal-meta'));
    if (guide.status) append(meta, statusBadge(guide.status));
    append(meta, createEl('span', 'risk-pill risk-' + guide.detail.risk, RISK_LABELS[guide.detail.risk]));
    append(meta, createEl('span', 'modal-path', guide.path || ''));
    // Reason badge for partial/access_denied entries [R17]
    if (entry.reason) {
      append(meta, createEl('span', 'reason-pill', 'Alasan: ' + entry.reason));
    }

    append(els.modalBody, createEl('p', 'modal-what', guide.detail.what));

    if (guide.detail.risk && RISK_HINTS[guide.detail.risk]) {
      append(els.modalBody, createEl('p', 'modal-risk-hint risk-text-' + guide.detail.risk, RISK_HINTS[guide.detail.risk]));
    }

    if (guide.hasScanData) {
      var sizeLine = append(els.modalBody, createEl('p', 'modal-note'));
      sizeLine.textContent = 'Ukuran saat ini: ' + guide.sizeHuman + ' · ' + formatCount(guide.fileCount) + ' file';
    } else {
      append(els.modalBody, createEl('p', 'modal-note', 'Buka tab "Hasil Pindai" untuk melihat ukuran folder ini di sistem Anda.'));
    }

    var facts = append(els.modalBody, createEl('div', 'fact-grid'));
    if (guide.detail.impact) {
      var impactCell = append(facts, createEl('div', 'fact'));
      append(impactCell, createEl('span', 'fact-label', 'Dampak bila dihapus'));
      append(impactCell, createEl('span', 'fact-value', guide.detail.impact));
    }
    if (guide.detail.regen) {
      var regenCell = append(facts, createEl('div', 'fact'));
      append(regenCell, createEl('span', 'fact-label', 'Terisi ulang'));
      append(regenCell, createEl('span', 'fact-value', guide.detail.regen));
    }
    var adminCell = append(facts, createEl('div', 'fact'));
    append(adminCell, createEl('span', 'fact-label', 'Hak Administrator'));
    append(adminCell, createEl('span', 'fact-value', guide.detail.admin ? 'Disarankan / perlu untuk sebagian file' : 'Tidak perlu'));

    if (guide.detail.note) {
      append(els.modalBody, createEl('p', 'modal-note', guide.detail.note));
    }

    var stepsSection = append(els.modalBody, createEl('div', 'modal-section'));
    append(stepsSection, createEl('h3', null,
      guide.detail.observationOnly ? 'Cara aman membebaskan ruang' : 'Cara hapus manual di File Explorer'));
    var stepList = append(stepsSection, createEl('ol', 'step-list'));
    guide.steps.forEach(function (step) {
      append(stepList, createEl('li', null, step));
    });

    if (guide.commands.length > 0) {
      var cmdSection = append(els.modalBody, createEl('div', 'modal-section'));
      append(cmdSection, createEl('h3', null, 'Command siap salin'));
      guide.commands.forEach(function (item) {
        addCommandBlock(cmdSection, item);
      });
    }

    if (guide.detail.windows && guide.detail.windows.length > 0) {
      var winSection = append(els.modalBody, createEl('div', 'modal-section'));
      append(winSection, createEl('h3', null, 'Lewat fitur bawaan Windows'));
      var winList = append(winSection, createEl('ul', 'step-list'));
      guide.detail.windows.forEach(function (hint) {
        append(winList, createEl('li', null, hint));
      });
    }

    var warnSection = append(els.modalBody, createEl('div', 'modal-section'));
    append(warnSection, createEl('h3', null, 'Jangan disentuh'));
    var warnList = append(warnSection, createEl('ul', 'warn-list'));
    [
      'Jangan hapus folder whitelist itu sendiri — cukup isinya.',
      'Jangan sentuh C:\\Windows\\Installer dan data pribadi (Documents, Desktop, Downloads, OneDrive).',
      'Jangan hapus junction, symlink, atau folder yang tidak Anda kenali.',
    ].forEach(function (warning) {
      append(warnList, createEl('li', null, warning));
    });
    append(
      els.modalBody,
      createEl(
        'p',
        'modal-disclaimer',
        'Aplikasi ini read-only: command di atas hanya ditampilkan untuk Anda salin dan jalankan sendiri. Tidak ada yang dieksekusi otomatis.',
      ),
    );
  }

  function openFolderModal(entry) {
    if (!els.modal || !entry) return;
    renderFolderModal(entry);
    els.modal.hidden = false;
    lastFocused = typeof document.activeElement !== 'undefined' ? document.activeElement : null;
    if (els.modalClose && typeof els.modalClose.focus === 'function') {
      els.modalClose.focus();
    }
  }

  function closeFolderModal() {
    if (!els.modal) return;
    els.modal.hidden = true;
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
    lastFocused = null;
  }

  // ---------------------------------------------------------------------------
  // Focus trap — keep Tab/Shift+Tab inside the open modal
  // ---------------------------------------------------------------------------

  function childNodesOf(node) {
    var out = [];
    var children = node && node.children;
    if (!children) return out;
    var length = typeof children.length === 'number' ? children.length : 0;
    for (var i = 0; i < length; i += 1) {
      var child = typeof children.item === 'function' ? children.item(i) : children[i];
      if (child) out.push(child);
    }
    return out;
  }

  function isFocusable(element) {
    if (!element || typeof element.focus !== 'function') return false;
    var tag = String(element.tagName || '').toUpperCase();
    if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT'
      || tag === 'SELECT' || tag === 'TEXTAREA') {
      return true;
    }
    return Number(element.tabIndex) >= 0;
  }

  function collectFocusable(root, out) {
    if (!root) return out;
    var children = childNodesOf(root);
    for (var i = 0; i < children.length; i += 1) {
      var child = children[i];
      if (isFocusable(child) && out.indexOf(child) === -1) out.push(child);
      collectFocusable(child, out);
    }
    return out;
  }

  // Ordered list of focusable elements inside the modal. The close button
  // (modal head) comes first, then anything focusable in the modal body.
  function getModalFocusables() {
    var list = [];
    collectFocusable(els.modal, list);
    collectFocusable(els.modalBody, list);
    if (isFocusable(els.modalClose) && list.indexOf(els.modalClose) === -1) {
      list.unshift(els.modalClose);
    }
    return list;
  }

  function trapFocus(event) {
    if (!event || event.key !== 'Tab') return;
    if (!els.modal || els.modal.hidden) return;
    var focusables = getModalFocusables();
    if (focusables.length === 0) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    var active = typeof document.activeElement !== 'undefined' ? document.activeElement : null;
    var inside = active != null && focusables.indexOf(active) !== -1;

    if (event.shiftKey) {
      if (!inside || active === first) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        last.focus();
      }
      return;
    }
    if (!inside || active === last) {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      first.focus();
    }
  }

  function renderCard(entry) {
    var card = createEl('div', 'card');
    card.tabIndex = 0;
    setAttr(card, 'role', 'button');
    setAttr(card, 'aria-label', 'Buka panduan hapus aman untuk ' + (entry.name || 'folder ini'));

    var top = append(card, createEl('div', 'card-top'));
    append(top, createEl('div', 'card-name', entry.name || '(tanpa nama)'));
    append(top, statusBadge(entry.status));

    if (entry.fallback === true) {
      var fallbackBadge = createEl('span', 'fallback-badge', 'Fallback — resolusi profil gagal');
      setAttr(fallbackBadge, 'role', 'note');
      setAttr(fallbackBadge, 'aria-label', 'Fallback — resolusi profil gagal; memakai C:\\Temp sebagai lokasi cadangan');
      setAttr(fallbackBadge, 'title', 'Fallback — resolusi profil gagal');
      append(card, fallbackBadge);
    }

    var risk = resolveFolderGuide(entry).risk;
    if (risk) {
      append(card, createEl('span', 'risk-pill risk-' + risk, 'Risiko: ' + RISK_LABELS[risk]));
    }

    append(card, createEl('div', 'card-path', entry.path || ''));

    var meta = append(card, createEl('div', 'card-meta'));

    var sizeMetric = append(meta, createEl('div', 'metric'));
    append(sizeMetric, createEl('b', null, entry.sizeHuman || sizeHuman(entry.sizeBytes || 0)));
    append(sizeMetric, createEl('span', null, 'Ukuran'));

    var fileMetric = append(meta, createEl('div', 'metric'));
    append(fileMetric, createEl('b', null, formatCount(entry.fileCount)));
    append(fileMetric, createEl('span', null, 'File'));

    append(card, createEl('span', 'card-hint', 'Klik untuk panduan hapus aman'));

    card.addEventListener('click', function () {
      openFolderModal(entry);
    });
    card.addEventListener('keydown', function (event) {
      var key = event && event.key;
      if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        openFolderModal(entry);
      }
    });

    return card;
  }

  function isZeroEntry(entry) {
    return (Number(entry.fileCount) || 0) === 0 && (Number(entry.sizeBytes) || 0) === 0;
  }

  function sortGroupEntries(groupEntries) {
    if (!prefs.sortBySizeDesc) return groupEntries.slice();
    return groupEntries
      .map(function (entry, index) {
        return { entry: entry, index: index };
      })
      .sort(function (a, b) {
        var diff = (Number(b.entry.sizeBytes) || 0) - (Number(a.entry.sizeBytes) || 0);
        if (diff !== 0) return diff;
        return a.index - b.index; // stable tie-break by original position
      })
      .map(function (item) { return item.entry; });
  }

  function renderScan(data) {
    state.lastScanData = data || null;
    var entries = Array.isArray(data && data.entries) ? data.entries : [];
    clearElement(els.resultsContent);
    clearElement(els.grandTotal);
    clearElement(els.emptyState);

    var totalBytes = entries.reduce(function (sum, entry) {
      return sum + (Number(entry.sizeBytes) || 0);
    }, 0);
    var isPartial = Boolean(data && data.partial);
    var totalText = (isPartial ? '≥' : '') + sizeHuman(totalBytes);

    // Summary bar (single source of truth for the grand total).
    append(els.grandTotal, createEl('span', 'total-label', 'Total keseluruhan'));
    append(els.grandTotal, createEl('span', 'total-value', totalText));
    append(
      els.grandTotal,
      createEl(
        'span',
        'total-note',
        isPartial
          ? 'Perkiraan minimum karena hasil pindai parsial.'
          : 'Hasil pindai lengkap.',
      ),
    );

    // Group entries and render one card grid per group.
    var groups = {};
    var hiddenZeroCount = 0;
    var hiddenNotFoundCount = 0;
    entries.forEach(function (entry) {
      var key = GROUP_LABELS[entry.group] ? entry.group : 'other';
      // Only not_found is hidden by this filter. In particular, access_denied
      // and partial entries remain visible even when they have zero size.
      // Fallback entries (profile resolution failed) are also exempt so the
      // user can see and act on the C:\Temp fallback warning.
      if (prefs.hideNotFound && entry.status === 'not_found' && entry.fallback !== true) {
        hiddenNotFoundCount += 1;
        return;
      }
      if (prefs.hideZero && isZeroEntry(entry) && entry.status !== 'access_denied' && entry.status !== 'partial') {
        hiddenZeroCount += 1;
        return;
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(entry);
    });

    var rendered = 0;
    GROUP_ORDER.forEach(function (key) {
      var groupEntries = groups[key];
      if (!groupEntries || groupEntries.length === 0) return;
      rendered += 1;

      var section = append(els.resultsContent, createEl('section', 'group'));
      var heading = append(section, createEl('h3'));
      append(heading, createEl('span', 'dot'));
      append(heading, createEl('span', null, GROUP_LABELS[key]));

      var grid = append(section, createEl('div', 'cards'));
      sortGroupEntries(groupEntries).forEach(function (entry) {
        append(grid, renderCard(entry));
      });
    });

    if (rendered === 0) {
      var emptyText = hiddenNotFoundCount > 0
        ? 'Folder tidak ditemukan di sistem ini.'
        : 'Belum ada data untuk ditampilkan.';
      append(els.resultsContent, createEl('div', 'empty', emptyText));
    }

    renderHiddenChip(hiddenZeroCount, hiddenNotFoundCount);

    if (els.emptyState) {
      if (allEntriesHaveStatus(entries, 'access_denied')) {
        els.emptyState.textContent = 'Semua folder tidak dapat diakses. Jalankan ulang dengan Run as Administrator jika ingin membaca folder sistem.';
      } else if (allEntriesHaveStatus(entries, 'not_found')) {
        els.emptyState.textContent = 'Folder tidak ditemukan di sistem ini.';
      }
    }

    if (els.scanStatus) {
      els.scanStatus.textContent = data && data.scannedAt ? 'Terakhir dipindai: ' + data.scannedAt : 'Terakhir dipindai.';
    }

    if (els.delta) {
      var baseline = findDeltaBaseline(data);
      if (baseline) {
        var baseBytes = baseline.totalBytes;
        var diff = baseBytes - totalBytes;
        if (diff > 0) {
          var baseTime = relativeTime(baseline.scannedAt);
          els.delta.textContent = 'Turun ' + sizeHumanId(diff) + ' sejak ' + baseTime;
        } else {
          els.delta.textContent = '';
        }
      } else {
        els.delta.textContent = '';
      }
    }

    if (els.markCleanedButton) els.markCleanedButton.hidden = false;
    renderCleanedStatus();
  }

  function renderHiddenChip(hiddenZeroCount, hiddenNotFoundCount) {
    if (!els.hiddenChip) return;
    clearElement(els.hiddenChip);
    if (hiddenZeroCount <= 0 && hiddenNotFoundCount <= 0) return;

    var labels = [];
    if (hiddenNotFoundCount > 0) {
      labels.push(hiddenNotFoundCount + ' folder disembunyikan (tidak ditemukan)');
    }
    if (hiddenZeroCount > 0) {
      labels.push(hiddenZeroCount + ' folder kosong disembunyikan');
    }
    els.hiddenChip.textContent = labels.join(' · ');
    els.hiddenChip.className = 'hidden-chip';
    setAttr(els.hiddenChip, 'role', 'button');
    setAttr(els.hiddenChip, 'tabindex', '0');
    setAttr(els.hiddenChip, 'aria-label', 'Tampilkan ' + labels.join(' dan '));

    function revealHidden() {
      if (hiddenNotFoundCount > 0) prefs.hideNotFound = false;
      if (hiddenZeroCount > 0) {
        prefs.hideZero = false;
        if (els.hideZeroToggle) els.hideZeroToggle.checked = false;
      }
      savePrefs();
      if (state.lastScanData) renderScan(state.lastScanData);
    }
    els.hiddenChip.addEventListener('click', revealHidden);
    els.hiddenChip.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        if (event.preventDefault) event.preventDefault();
        revealHidden();
      }
    });
  }

  function renderError(error) {
    if (els.scanStatus) {
      els.scanStatus.textContent = 'Gagal memindai: ' + (error && error.message ? error.message : 'error tidak diketahui');
    }
  }

  function bindPreferences() {
    if (els.sortToggle) {
      els.sortToggle.checked = Boolean(prefs.sortBySizeDesc);
      els.sortToggle.addEventListener('change', function () {
        prefs.sortBySizeDesc = Boolean(els.sortToggle.checked);
        savePrefs();
        if (state.lastScanData) renderScan(state.lastScanData);
      });
    }
    if (els.hideZeroToggle) {
      els.hideZeroToggle.checked = Boolean(prefs.hideZero);
      els.hideZeroToggle.addEventListener('change', function () {
        prefs.hideZero = Boolean(els.hideZeroToggle.checked);
        savePrefs();
        if (state.lastScanData) renderScan(state.lastScanData);
      });
    }
  }

  function scan() {
    var requestId = ++state.nextRequestId;
    state.latestSentRequestId = requestId;
    state.inFlight += 1;
    setLoading(true);

    // Prioritize SSE, fall back to fetch on error or unavailability
    if (typeof EventSource !== 'undefined') {
      var es = new EventSource('/api/scan/stream');
      var hasFolderEvents = false;

      es.addEventListener('folder', function (event) {
        if (requestId === state.latestSentRequestId) {
          hasFolderEvents = true;
          var entry = JSON.parse(event.data);
          // To show incremental progress, update the state.lastScanData with
          // just this entry, then re-render (which clears/rebuilds DOM).
          var currentEntries = Array.isArray(state.lastScanData && state.lastScanData.entries)
            ? state.lastScanData.entries.slice()
            : [];
          var existingIdx = currentEntries.findIndex(function (e) { return e.path === entry.path; });
          if (existingIdx !== -1) {
            currentEntries[existingIdx] = entry;
          } else {
            currentEntries.push(entry);
          }
          // Simulate partial state as we stream.
          renderScan({ entries: currentEntries, scannedAt: null, partial: true });
        }
      });

      es.addEventListener('done', function (event) {
        if (requestId === state.latestSentRequestId) {
          var data = JSON.parse(event.data);
          recordScan(data);
          renderScan(data);
        }
        es.close();
        state.inFlight -= 1;
        if (requestId === state.latestSentRequestId || state.inFlight <= 0) {
          setLoading(false);
        }
      });

      es.addEventListener('error', function (error) {
        es.close();
        if (!hasFolderEvents) {
          // Stream failed before producing data: fall back to the JSON endpoint
          // for this request. fetchFallback owns the inFlight/loading bookkeeping.
          fetchFallback(requestId);
        } else {
          // The stream had already rendered partial progress; stop streaming and
          // clear loading without issuing a duplicate fetch.
          state.inFlight -= 1;
          if (requestId === state.latestSentRequestId || state.inFlight <= 0) {
            setLoading(false);
            renderError(error);
          }
        }
      });
    } else {
      // Fallback: EventSource is not available
      fetchFallback(requestId);
    }

    function fetchFallback(currentRequestId) {
      return fetch('/api/scan')
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          if (currentRequestId === state.latestSentRequestId) {
            recordScan(data);
            renderScan(data);
          }
        })
        .catch(function (error) {
          if (currentRequestId === state.latestSentRequestId) {
            renderError(error);
          }
        })
        .then(function () {
          state.inFlight -= 1;
          if (currentRequestId === state.latestSentRequestId || state.inFlight <= 0) {
            setLoading(false);
          }
        });
    }
  }

  function setAriaSelected(element, selected) {
    if (!element) return;
    if (typeof element.setAttribute === 'function') {
      element.setAttribute('aria-selected', String(selected));
    }
  }

  function showTab(tabName) {
    if (els.resultsPanel) els.resultsPanel.hidden = tabName !== 'results';
    if (els.cleanupPanel) els.cleanupPanel.hidden = tabName !== 'cleanup';
    if (els.guidePanel) els.guidePanel.hidden = tabName !== 'guide';
    setAriaSelected(els.tabResults, tabName === 'results');
    setAriaSelected(els.tabCleanup, tabName === 'cleanup');
    setAriaSelected(els.tabGuide, tabName === 'guide');
    if (tabName === 'guide') renderGuide();
    if (tabName === 'cleanup') ensureCleanupTargets();
  }

  // ---------------------------------------------------------------------------
  // Bersihkan Cache — safe cleanup flow (preview → confirm → job → result)
  // ---------------------------------------------------------------------------

  var cleanup = {
    targetsLoaded: false,
    targets: [],
    selected: {},
    confirmationToken: null,
    preview: null,
    jobId: null,
    polling: null,
    running: false,
  };

  function cleanupFetch(path, options) {
    return fetch(path, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var message = body && body.error ? body.error : 'HTTP ' + res.status;
          var err = new Error(message);
          err.status = res.status;
          err.body = body;
          throw err;
        }
        return body;
      });
    });
  }

  function riskTagClass(risk) {
    if (risk === 'safe') return 'tag-safe';
    if (risk === 'caution') return 'tag-caution';
    return 'tag-protected';
  }

  function riskLabel(risk) {
    if (risk === 'safe') return 'Aman';
    if (risk === 'caution') return 'Hati-hati';
    return 'Lindungi';
  }

  function selectedTargetIds() {
    return Object.keys(cleanup.selected).filter(function (id) {
      return cleanup.selected[id];
    });
  }

  function updateCleanupActions() {
    var count = selectedTargetIds().length;
    if (els.cleanupPreviewButton) els.cleanupPreviewButton.disabled = count === 0 || cleanup.running;
  }

  function ensureCleanupTargets() {
    if (cleanup.targetsLoaded) return Promise.resolve();
    return loadCleanupTargets();
  }

  function loadCleanupTargets() {
    if (!els.cleanupTargets) return Promise.resolve();
    clearElement(els.cleanupTargets);
    append(els.cleanupTargets, createEl('p', 'cleanup-loading', 'Memuat daftar target…'));

    return cleanupFetch('/api/cleanup/targets')
      .then(function (body) {
        cleanup.targets = Array.isArray(body && body.targets) ? body.targets : [];
        cleanup.targetsLoaded = true;
        renderCleanupTargets();
      })
      .catch(function (error) {
        clearElement(els.cleanupTargets);
        append(els.cleanupTargets, createEl('p', 'cleanup-loading result-error', 'Gagal memuat target: ' + error.message));
      });
  }

  function renderCleanupTargets() {
    if (!els.cleanupTargets) return;
    clearElement(els.cleanupTargets);

    if (cleanup.targets.length === 0) {
      append(els.cleanupTargets, createEl('p', 'cleanup-loading', 'Tidak ada target yang dapat dibersihkan.'));
      return;
    }

    cleanup.targets.forEach(function (target) {
      var card = createEl('label', 'target-card');
      if (cleanup.selected[target.id]) card.className += ' is-selected';

      var head = append(card, createEl('div', 'target-head'));
      var checkbox = createEl('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(cleanup.selected[target.id]);
      checkbox.disabled = cleanup.running;
      setAttr(checkbox, 'aria-label', 'Pilih target ' + target.name);
      append(head, checkbox);

      var titles = append(head, createEl('div', 'target-titles'));
      append(titles, createEl('span', 'target-name', target.name));
      append(titles, createEl('span', 'target-desc', target.description || ''));

      append(card, createEl('span', 'target-path', target.displayPath || ''));

      var tags = append(card, createEl('div', 'target-tags'));
      append(tags, createEl('span', 'tag tag-cat', target.category || 'other'));
      append(tags, createEl('span', 'tag ' + riskTagClass(target.risk), riskLabel(target.risk)));
      append(tags, createEl('span', 'tag tag-caution', 'Lewati < ' + (target.minimumAgeHours || 24) + ' jam'));

      checkbox.addEventListener('change', function () {
        if (checkbox.checked) cleanup.selected[target.id] = true;
        else delete cleanup.selected[target.id];
        if (checkbox.checked) card.className += ' is-selected';
        else card.className = card.className.replace(' is-selected', '');
        resetCleanupFlow();
        updateCleanupActions();
      });

      append(els.cleanupTargets, card);
    });

    updateCleanupActions();
  }

  function resetCleanupFlow() {
    cleanup.confirmationToken = null;
    cleanup.preview = null;
    if (els.cleanupPreview) { els.cleanupPreview.hidden = true; clearElement(els.cleanupPreview); }
    if (els.cleanupConfirmWrap) els.cleanupConfirmWrap.hidden = true;
    if (els.cleanupConfirmCheck) els.cleanupConfirmCheck.checked = false;
    if (els.cleanupStartButton) els.cleanupStartButton.disabled = true;
    if (els.cleanupResult) { els.cleanupResult.hidden = true; clearElement(els.cleanupResult); }
  }

  function cleanupPreview() {
    var ids = selectedTargetIds();
    if (ids.length === 0 || cleanup.running) return;

    if (els.cleanupPreviewButton) { els.cleanupPreviewButton.disabled = true; els.cleanupPreviewButton.textContent = 'Menghitung…'; }
    if (els.cleanupResult) { els.cleanupResult.hidden = true; clearElement(els.cleanupResult); }

    cleanupFetch('/api/cleanup/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targets: ids }),
    })
      .then(function (body) {
        cleanup.preview = body;
        cleanup.confirmationToken = body.confirmationToken || null;
        renderCleanupPreview(body);
        if (els.cleanupConfirmWrap) els.cleanupConfirmWrap.hidden = false;
        if (els.cleanupConfirmCheck) els.cleanupConfirmCheck.checked = false;
        if (els.cleanupStartButton) els.cleanupStartButton.disabled = true;
      })
      .catch(function (error) {
        if (els.cleanupPreview) {
          clearElement(els.cleanupPreview);
          els.cleanupPreview.hidden = false;
          var box = append(els.cleanupPreview, createEl('div', 'cleanup-result'));
          append(box, createEl('p', 'result-error', 'Pratinjau gagal: ' + error.message));
        }
      })
      .then(function () {
        if (els.cleanupPreviewButton) { els.cleanupPreviewButton.textContent = 'Pratinjau'; updateCleanupActions(); }
      });
  }

  function renderCleanupPreview(body) {
    if (!els.cleanupPreview) return;
    clearElement(els.cleanupPreview);
    els.cleanupPreview.hidden = false;

    append(els.cleanupPreview, createEl('h3', null, 'Pratinjau — belum ada yang dihapus'));

    var stats = append(els.cleanupPreview, createEl('div', 'preview-stats'));
    [
      ['File akan dihapus', formatCount(body.eligibleFiles || 0)],
      ['Folder akan dihapus', formatCount(body.eligibleDirectories || 0)],
      ['Perkiraan ruang', sizeHuman(body.estimatedBytes || 0)],
      ['File terlalu baru (dilewati)', formatCount(body.skippedRecentFiles || 0)],
      ['File dilindungi (dilewati)', formatCount(body.skippedProtectedFiles || 0)],
    ].forEach(function (pair) {
      var stat = append(stats, createEl('div', 'preview-stat'));
      append(stat, createEl('b', null, pair[1]));
      append(stat, createEl('span', null, pair[0]));
    });

    var targets = Array.isArray(body.targets) ? body.targets : [];
    if (targets.length > 0) {
      var wrap = append(els.cleanupPreview, createEl('div', 'preview-table-wrap'));
      var table = append(wrap, createEl('table', 'preview-table'));
      var thead = append(table, createEl('thead'));
      var headRow = append(thead, createEl('tr'));
      ['Target', 'File', 'Folder', 'Ruang', 'Dilewati (baru)'].forEach(function (label) {
        append(headRow, createEl('th', null, label));
      });
      var tbody = append(table, createEl('tbody'));
      targets.forEach(function (item) {
        var row = append(tbody, createEl('tr'));
        append(row, createEl('td', null, item.name || item.targetId));
        append(row, createEl('td', 'num', formatCount(item.eligibleFiles || 0)));
        append(row, createEl('td', 'num', formatCount(item.eligibleDirectories || 0)));
        append(row, createEl('td', 'num', sizeHuman(item.estimatedBytes || 0)));
        append(row, createEl('td', 'num', formatCount(item.skippedRecentFiles || 0)));
      });
    }

    if ((body.eligibleFiles || 0) === 0) {
      append(els.cleanupPreview, createEl('p', 'result-note result-warn', 'Tidak ada file yang memenuhi syarat (mungkin semua masih baru atau dilindungi).'));
    }
  }

  function startCleanup() {
    var ids = selectedTargetIds();
    if (ids.length === 0 || !cleanup.confirmationToken || cleanup.running) return;

    cleanup.running = true;
    updateCleanupActions();
    if (els.cleanupStartButton) els.cleanupStartButton.disabled = true;
    if (els.cleanupConfirmWrap) els.cleanupConfirmWrap.hidden = true;
    if (els.cleanupResult) { els.cleanupResult.hidden = true; clearElement(els.cleanupResult); }
    showCleanupProgress();

    cleanupFetch('/api/cleanup/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targets: ids, confirmationToken: cleanup.confirmationToken }),
    })
      .then(function (body) {
        cleanup.jobId = body.jobId;
        cleanup.confirmationToken = null;
        pollCleanupJob(body.jobId);
      })
      .catch(function (error) {
        cleanup.running = false;
        hideCleanupProgress();
        renderCleanupResult({ error: error.message });
        updateCleanupActions();
      });
  }

  function showCleanupProgress() {
    if (els.cleanupProgress) els.cleanupProgress.hidden = false;
    if (els.cleanupProgressLabel) els.cleanupProgressLabel.textContent = 'Menghapus…';
    if (els.cleanupProgressBar) els.cleanupProgressBar.style.width = '0%';
    if (els.cleanupProgressDetail) els.cleanupProgressDetail.textContent = '';
    if (els.cleanupCancelButton) els.cleanupCancelButton.disabled = false;
  }

  function hideCleanupProgress() {
    if (els.cleanupProgress) els.cleanupProgress.hidden = true;
  }

  function pollCleanupJob(jobId) {
    cleanupFetch('/api/cleanup/jobs/' + encodeURIComponent(jobId))
      .then(function (job) {
        renderCleanupProgress(job);
        if (job.status === 'queued' || job.status === 'running') {
          cleanup.polling = setTimeout(function () { pollCleanupJob(jobId); }, 600);
          return;
        }
        cleanup.running = false;
        cleanup.jobId = null;
        hideCleanupProgress();
        renderCleanupResult(job);
        updateCleanupActions();
        scan();
      })
      .catch(function (error) {
        cleanup.running = false;
        hideCleanupProgress();
        renderCleanupResult({ error: error.message });
        updateCleanupActions();
      });
  }

  function renderCleanupProgress(job) {
    var progress = job.progress || {};
    var total = Number(progress.totalFiles) || 0;
    var processed = Number(progress.processedFiles) || 0;
    var pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
    if (els.cleanupProgressBar) els.cleanupProgressBar.style.width = pct + '%';
    if (els.cleanupProgressDetail) {
      els.cleanupProgressDetail.textContent = formatCount(processed) + ' file diproses · ' + sizeHuman(progress.bytesDeleted || 0) + ' dibebaskan';
    }
  }

  function cancelCleanup() {
    if (!cleanup.jobId) return;
    if (els.cleanupCancelButton) els.cleanupCancelButton.disabled = true;
    if (els.cleanupProgressLabel) els.cleanupProgressLabel.textContent = 'Membatalkan…';
    cleanupFetch('/api/cleanup/jobs/' + encodeURIComponent(cleanup.jobId) + '/cancel', { method: 'POST' })
      .catch(function () { /* polling will surface the final state */ });
  }

  function renderCleanupResult(job) {
    if (!els.cleanupResult) return;
    clearElement(els.cleanupResult);
    els.cleanupResult.hidden = false;

    if (job.error) {
      append(els.cleanupResult, createEl('h3', 'result-error', 'Pembersihan gagal'));
      append(els.cleanupResult, createEl('p', 'result-note', job.error));
      return;
    }

    var result = job.result || {};
    var totals = result.totals || {};
    var cancelled = job.status === 'cancelled';

    append(els.cleanupResult, createEl('h3', cancelled ? 'result-warn' : 'result-ok', cancelled ? 'Pembersihan dibatalkan' : 'Pembersihan selesai'));

    var lines = [
      ['File dihapus', formatCount(totals.filesDeleted || 0)],
      ['Folder dihapus', formatCount(totals.directoriesDeleted || 0)],
      ['Ruang dibebaskan', sizeHuman(totals.bytesDeleted || 0)],
      ['Dilewati (terlalu baru)', formatCount(totals.skippedRecent || 0)],
      ['Dilewati (terkunci)', formatCount(totals.skippedLocked || 0)],
      ['Dilewati (dilindungi)', formatCount(totals.protected || 0)],
      ['Akses ditolak', formatCount(totals.accessDenied || 0)],
      ['Gagal', formatCount(totals.failed || 0)],
    ];
    lines.forEach(function (pair) {
      var line = append(els.cleanupResult, createEl('div', 'result-line'));
      append(line, createEl('span', null, pair[0]));
      append(line, createEl('span', null, pair[1]));
    });

    append(els.cleanupResult, createEl('p', 'result-note', 'Hasil pindai diperbarui otomatis. Cookie, riwayat, dan sandi browser tidak pernah disentuh.'));
  }

  function initCleanup() {
    if (els.cleanupPreviewButton) els.cleanupPreviewButton.addEventListener('click', cleanupPreview);
    if (els.cleanupStartButton) els.cleanupStartButton.addEventListener('click', startCleanup);
    if (els.cleanupCancelButton) els.cleanupCancelButton.addEventListener('click', cancelCleanup);
    if (els.cleanupConfirmCheck) {
      els.cleanupConfirmCheck.addEventListener('change', function () {
        if (els.cleanupStartButton) els.cleanupStartButton.disabled = !els.cleanupConfirmCheck.checked;
      });
    }
  }

  function handleKeydown(event) {
    if (event && event.key === 'Escape') closeFolderModal();
  }

  function init() {
    getElements();
    if (!els.refreshButton) return;
    state.originalRefreshLabel = els.refreshButton.textContent || 'Pindai Ulang';
    renderGuide();
    showTab('results');
    if (els.modal) els.modal.hidden = true;
    els.refreshButton.addEventListener('click', scan);
    if (els.tabResults) els.tabResults.addEventListener('click', function () { showTab('results'); });
    if (els.tabCleanup) els.tabCleanup.addEventListener('click', function () { showTab('cleanup'); });
    if (els.tabGuide) els.tabGuide.addEventListener('click', function () { showTab('guide'); });
    if (els.modalClose) els.modalClose.addEventListener('click', closeFolderModal);
    if (els.modalBackdrop) els.modalBackdrop.addEventListener('click', closeFolderModal);
    if (els.modal) els.modal.addEventListener('keydown', trapFocus);
    document.addEventListener('keydown', handleKeydown);
    if (els.markCleanedButton) {
      els.markCleanedButton.hidden = true;
      els.markCleanedButton.addEventListener('click', markCleaned);
    }
    bindPreferences();
    renderCleanedStatus();
    initCleanup();
    scan();
  }

  document.addEventListener('DOMContentLoaded', init);

  window.cleanupScanner = {
    init: init,
    scan: scan,
    renderScan: renderScan,
    renderGuide: renderGuide,
    showTab: showTab,
    sizeHuman: sizeHuman,
    formatCount: formatCount,
    renderCard: renderCard,
    buildFolderGuide: buildFolderGuide,
    openFolderModal: openFolderModal,
    openCatalogModal: openCatalogModal,
    closeFolderModal: closeFolderModal,
    trapFocus: trapFocus,
    FOLDER_CATALOG: FOLDER_CATALOG,
  };
})();
