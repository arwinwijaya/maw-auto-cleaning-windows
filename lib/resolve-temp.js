'use strict';

const { execFile } = require('node:child_process');
const path = require('node:path');

/**
 * Query the Windows registry for the current user's Local AppData folder.
 * Returns a promise resolving to the path string or null on failure.
 *
 * @param {string} [queryFn] - Optional query function for dependency injection.
 *   If omitted, the default registry query is used.
 * @returns {Promise<string|null>}
 */
async function queryLocalAppData(queryFn) {
  // If a custom query function is provided, use it.
  if (typeof queryFn === 'function') {
    return queryFn();
  }

  // Default read-only registry query.
  return new Promise((resolve) => {
    execFile(
      'reg',
      [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
        '/v',
        'Local AppData',
      ],
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        // Parse the output for the path.
        const lines = stdout.split(/\r?\n/);
        for (const line of lines) {
          // The output format is like:
          // HKCU\...\Local AppData    REG_EXPAND_SZ    C:\Users\<user>\AppData\Local
          const match = line.match(
            /HKCU\\.*\\Local AppData\s+REG_EXPAND_SZ\s+(.+)/i,
          );
          if (match) {
            resolve(match[1].trim());
            return;
          }
        }
        resolve(null);
      },
    );
  });
}

/**
 * Resolve the current user's Local AppData folder and Temp folder together.
 *
 * When running elevated, process.env.TEMP may point to a non-user-local Temp
 * (e.g., C:\Windows\Temp). This function resolves the logged-in user's
 * Local AppData via a read-only registry query, falling back to
 * %LOCALAPPDATA% and finally %TEMP% if necessary.
 *
 * @param {Function} [queryFn] - Optional function for dependency injection (testing).
 * @returns {Promise<{ localAppData: string|null, temp: string, usedFallback: boolean }>}
 */
async function resolveUserPaths(queryFn) {
  let localAppData;
  try {
    localAppData = await queryLocalAppData(queryFn);
  } catch {
    // Registry access can fail (for example, reg.exe unavailable); use the
    // environment fallback without propagating the error.
    localAppData = null;
  }
  if (!localAppData) {
    localAppData = process.env.LOCALAPPDATA || null;
  }

  const usedFallback = !localAppData && !process.env.TEMP;
  const temp = localAppData
    ? path.join(localAppData, 'Temp')
    : (process.env.TEMP || 'C:\\Temp');

  return { localAppData, temp, usedFallback };
}

/**
 * Resolve the path to the current user's Temp folder.
 *
 * @param {Function} [queryFn] - Optional function for dependency injection (testing).
 * @returns {Promise<string>} The resolved Temp folder path.
 */
async function resolveTemp(queryFn) {
  const { temp } = await resolveUserPaths(queryFn);
  return temp;
}

module.exports = {
  resolveTemp,
  resolveUserPaths,
  queryLocalAppData,
};
