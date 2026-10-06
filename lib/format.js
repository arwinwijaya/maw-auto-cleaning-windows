'use strict';

/**
 * Formatting helpers for the Cleanup Web Scanner.
 *
 * ## JSON contract shape (GET /api/scan)
 *
 * Top-level response:
 * ```
 * {
 *   entries: [Entry, ...],   // exactly 5 whitelist folders
 *   scannedAt: string,       // ISO-8601 with local offset, taken when scan completes
 *   partial: boolean         // true if >= 1 entry has status "partial"
 * }
 * ```
 *
 * Entry:
 * ```
 * {
 *   name: string,      // display name, e.g. "Local\\Temp"
 *   path: string,      // absolute Windows path, e.g. "C:\\Users\\<user>\\AppData\\Local\\Temp"
 *   fileCount: number, // number of files counted (0 when not scanned / not found)
 *   sizeBytes: number, // total size in bytes (0 when not scanned / not found)
 *   sizeHuman: string, // human-readable size, see sizeHuman() below
 *   status: "ready" | "not_found" | "access_denied" | "partial"
 * }
 * ```
 *
 * status enum:
 * - `ready`        — folder scanned completely
 * - `not_found`    — folder does not exist
 * - `access_denied`— folder (or its root) could not be read (e.g. needs admin)
 * - `partial`      — folder scanned but incomplete (skipped >10% of files, or timed out)
 *
 * sizeHuman rules: base 1024, 1 decimal place, `en` locale, `0` → `"0 B"`.
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/**
 * Format a byte count as a human-readable string.
 *
 * Base 1024, 1 decimal place, `en` locale. `0` returns exactly `"0 B"`.
 *
 * Examples: `0` → `"0 B"`, `2684354560` → `"2.5 GB"`.
 *
 * @param {number} sizeBytes - Size in bytes (non-negative; `0` → `"0 B"`).
 * @returns {string} Human-readable size, e.g. `"0 B"`, `"1.2 KB"`, `"2.5 GB"`.
 */
function sizeHuman(sizeBytes) {
  if (sizeBytes === 0) {
    return '0 B';
  }

  let value = sizeBytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    // Bytes: no decimal place needed (e.g. "512 B").
    return `${value} ${UNITS[unitIndex]}`;
  }

  return `${value.toFixed(1)} ${UNITS[unitIndex]}`;
}

module.exports = {
  sizeHuman,
};
