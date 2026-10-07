'use strict';

/**
 * Formatting helpers for the Disk Usage Analyzer.
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
