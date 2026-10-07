'use strict';

const RULES = [
  { pattern: /\\AppData\\Local\\Temp$/i, risk: 'safe-cache', category: 'temporary', guideId: 'windows-user-temp', reason: 'File sementara pengguna; tutup aplikasi dan abaikan file yang sedang digunakan.' },
  { pattern: /^C:\\Windows\\Temp$/i, risk: 'safe-cache', category: 'temporary', guideId: 'windows-temp', reason: 'File sementara Windows; file aktif harus dilewati.' },
  { pattern: /\\npm-cache$/i, risk: 'safe-cache', category: 'package-cache', guideId: 'npm-cache', reason: 'Cache npm dapat diverifikasi dan dikelola dengan perintah resmi npm.' },
  { pattern: /\\pip\\Cache$/i, risk: 'safe-cache', category: 'package-cache', guideId: 'pip-cache', reason: 'Cache unduhan pip; paket dapat diunduh kembali.' },
  { pattern: /\\uv\\cache$/i, risk: 'safe-cache', category: 'package-cache', guideId: 'uv-cache', reason: 'Hanya cache uv terdeteksi; verifikasi lokasi dengan uv cache dir.' },
  { pattern: /\\(Cache|Code Cache|GPUCache)$/i, risk: 'safe-cache', category: 'browser-cache', guideId: 'chrome-cache', reason: 'Cache standar browser; lebih aman dibersihkan dari pengaturan browser.' },
  { pattern: /\\Service Worker\\CacheStorage$/i, risk: 'review', category: 'application-data', guideId: 'chrome-service-worker', reason: 'Data offline website/PWA; penghapusan dapat membuang data offline.' },
  { pattern: /\\\.gradle\\caches$/i, risk: 'review', category: 'build-cache', guideId: 'gradle-cache', reason: 'Cache build Gradle; dependency dapat diunduh ulang.' },
  { pattern: /\\Android\\Sdk$/i, risk: 'protected', category: 'development-sdk', reason: 'Android SDK diperlukan untuk membangun dan menjalankan aplikasi Android.' },
  { pattern: /\\(Docker|docker)\\(overlay2|volumes|buildkit|containers)$/i, risk: 'review', category: 'docker-storage', guideId: 'docker-storage', reason: 'Penyimpanan Docker dapat berisi image/container/data yang masih dibutuhkan.' },
  { pattern: /^C:\\Windows\\(System32|WinSxS|Installer)(\\|$)/i, risk: 'protected', category: 'windows-system', reason: 'Komponen Windows penting; jangan dihapus.' },
  { pattern: /^C:\\Program Files( \(x86\))?(\\|$)/i, risk: 'protected', category: 'applications', reason: 'File aplikasi terpasang; gunakan uninstaller resmi.' },
  { pattern: /\\Google\\Chrome\\User Data(\\|$)/i, risk: 'protected', category: 'browser-profile', reason: 'Profil browser dapat berisi data aplikasi dan pengaturan penting. Jangan hapus seluruh profil.' },
  { pattern: /\\(Documents|Desktop|Downloads|Pictures|Videos|Music)(\\|$)/i, risk: 'protected', category: 'personal-data', reason: 'Folder data pengguna; periksa file satu per satu.' },
  { pattern: /\\(\.git|\.ssh)(\\|$)/i, risk: 'protected', category: 'user-data', reason: 'Repository atau kunci autentikasi pribadi.' },
];
function classify(displayPath) {
  const value = String(displayPath || '').replace(/\//g, '\\').replace(/\\+$/, '');
  for (const rule of RULES) if (rule.pattern.test(value)) return { risk: rule.risk, category: rule.category, guideId: rule.guideId || null, reason: rule.reason };
  return { risk: 'unknown', category: 'unknown', guideId: null, reason: 'Tidak ada aturan klasifikasi yang diverifikasi.' };
}
module.exports = { classify, RULES };
