'use strict';

const path = require('node:path');

/**
 * Centralized cleanup target registry — single source of truth for all
 * allowlisted cleanup locations.
 *
 * Each target has:
 * - id: unique stable key used by API (e.g. "windows-user-temp")
 * - name: short display name (e.g. "Local\\Temp")
 * - category: grouping (temp, cache, logs, system)
 * - description: human-readable explanation
 * - risk: "safe" | "caution" | "protected" (drives UI auto-selection)
 * - internalPath: path inside the container (bind mount)
 * - displayPath: Windows path shown to the user
 * - enabled: whether this target is active
 * - minimumAgeHours: files newer than this are skipped (default 24)
 * - supportsCleaning: whether cleanup is implemented
 * - requiresConfirmation: always true for safety
 * - autoSelectable: true for "safe" targets (pre-checked in UI)
 */

const TARGETS = [
  {
    id: 'windows-user-temp',
    name: 'Local\\Temp',
    category: 'temp',
    description: 'User temporary files (%LOCALAPPDATA%\\Temp). Safe to clean routinely.',
    risk: 'safe',
    internalPath: '/cleanup/local-temp',
    displayPath: 'C:\\Users\\%USERNAME%\\AppData\\Local\\Temp',
    enabled: true,
    minimumAgeHours: 24,
    supportsCleaning: true,
    requiresConfirmation: true,
    autoSelectable: true,
  },
  {
    id: 'windows-system-temp',
    name: 'Windows\\Temp',
    category: 'temp',
    description: 'System temporary files (C:\\Windows\\Temp). Requires Administrator.',
    risk: 'safe',
    internalPath: '/cleanup/windows-temp',
    displayPath: 'C:\\Windows\\Temp',
    enabled: true,
    minimumAgeHours: 24,
    supportsCleaning: true,
    requiresConfirmation: true,
    autoSelectable: true,
  },
  {
    id: 'd-temp',
    name: 'D:\\Temp',
    category: 'temp',
    description: 'Temporary folder on D: drive if present.',
    risk: 'safe',
    internalPath: '/cleanup/d-temp',
    displayPath: 'D:\\Temp',
    enabled: true,
    minimumAgeHours: 24,
    supportsCleaning: true,
    requiresConfirmation: true,
    autoSelectable: true,
  },
  {
    id: 'npm-cache',
    name: 'npm cache',
    category: 'cache',
    description: 'npm package cache. Only the cache directory, not node_modules or global packages.',
    risk: 'safe',
    internalPath: '/cleanup/npm-cache',
    displayPath: '%LOCALAPPDATA%\\npm-cache',
    enabled: true,
    minimumAgeHours: 24,
    supportsCleaning: true,
    requiresConfirmation: true,
    autoSelectable: true,
  },
  {
    id: 'uv-cache',
    name: 'uv cache',
    category: 'cache',
    description: 'uv (Python package manager) cache. CAUTION until exact cache root is confirmed.',
    risk: 'caution',
    internalPath: '/cleanup/uv-cache',
    displayPath: '%LOCALAPPDATA%\\uv\\cache',
    enabled: true,
    minimumAgeHours: 24,
    supportsCleaning: true,
    requiresConfirmation: true,
    autoSelectable: false,
  },
  {
    id: 'pip-cache',
    name: 'pip cache',
    category: 'cache',
    description: 'pip package cache. Safe to clean.',
    risk: 'safe',
    internalPath: '/cleanup/pip-cache',
    displayPath: '%LOCALAPPDATA%\\pip\\cache',
    enabled: true,
    minimumAgeHours: 24,
    supportsCleaning: true,
    requiresConfirmation: true,
    autoSelectable: true,
  },
  {
    id: 'chrome-cache',
    name: 'Chrome cache',
    category: 'cache',
    description: 'Chrome browser cache (Cache, Code Cache, GPUCache only). Cookies, history, passwords are NOT touched.',
    risk: 'safe',
    internalPath: '/cleanup/chrome-cache',
    displayPath: '%LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default\\Cache',
    enabled: true,
    minimumAgeHours: 24,
    supportsCleaning: true,
    requiresConfirmation: true,
    autoSelectable: true,
  },
  {
    id: 'edge-cache',
    name: 'Edge cache',
    category: 'cache',
    description: 'Edge browser cache (Cache, Code Cache, GPUCache only). Cookies, history, passwords are NOT touched.',
    risk: 'safe',
    internalPath: '/cleanup/edge-cache',
    displayPath: '%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\Default\\Cache',
    enabled: true,
    minimumAgeHours: 24,
    supportsCleaning: true,
    requiresConfirmation: true,
    autoSelectable: true,
  },
  {
    id: 'directx-cache',
    name: 'DirectX shader cache',
    category: 'cache',
    description: 'Direct3D shader cache (D3DSCache) and NVIDIA DXCache/GLCache. Safe; rebuilt on next run.',
    risk: 'safe',
    internalPath: '/cleanup/directx-cache',
    displayPath: '%LOCALAPPDATA%\\D3DSCache',
    enabled: true,
    minimumAgeHours: 24,
    supportsCleaning: true,
    requiresConfirmation: true,
    autoSelectable: true,
  },
  {
    id: 'crash-dumps',
    name: 'Crash dumps',
    category: 'logs',
    description: 'Application crash dumps (WER, Minidump, LiveKernelReports, CrashDumps). Safe if not debugging.',
    risk: 'safe',
    internalPath: '/cleanup/crash-dumps',
    displayPath: '%LOCALAPPDATA%\\CrashDumps',
    enabled: true,
    minimumAgeHours: 24,
    supportsCleaning: true,
    requiresConfirmation: true,
    autoSelectable: true,
  },
];

/**
 * Get all registered targets.
 * @returns {Array<Object>}
 */
function getAllTargets() {
  return TARGETS.map(t => ({ ...t }));
}

/**
 * Get enabled targets that support cleaning.
 * @returns {Array<Object>}
 */
function getCleanableTargets() {
  return TARGETS.filter(t => t.enabled && t.supportsCleaning).map(t => ({ ...t }));
}

/**
 * Get targets that are safe and auto-selectable.
 * @returns {Array<Object>}
 */
function getAutoSelectableTargets() {
  return TARGETS.filter(t => t.enabled && t.supportsCleaning && t.autoSelectable).map(t => ({ ...t }));
}

/**
 * Find a target by ID.
 * @param {string} id
 * @returns {Object|null}
 */
function findTargetById(id) {
  const target = TARGETS.find(t => t.id === id);
  return target ? { ...target } : null;
}

/**
 * Validate that a list of target IDs are all known and cleanable.
 * @param {string[]} ids
 * @returns {{ valid: boolean, targets: Array<Object>, invalid: string[] }}
 */
function validateTargetIds(ids) {
  const targets = [];
  const invalid = [];
  for (const id of ids) {
    const target = findTargetById(id);
    if (!target) {
      invalid.push(id);
      continue;
    }
    if (!target.enabled || !target.supportsCleaning) {
      invalid.push(id);
      continue;
    }
    targets.push(target);
  }
  return { valid: invalid.length === 0, targets, invalid };
}

/**
 * Get the internal (container) path for a target ID.
 * @param {string} id
 * @returns {string|null}
 */
function getInternalPath(id) {
  const target = findTargetById(id);
  return target?.internalPath ?? null;
}

/**
 * Get the display (Windows) path for a target ID.
 * @param {string} id
 * @returns {string|null}
 */
function getDisplayPath(id) {
  const target = findTargetById(id);
  return target?.displayPath ?? null;
}

module.exports = {
  TARGETS,
  getAllTargets,
  getCleanableTargets,
  getAutoSelectableTargets,
  findTargetById,
  validateTargetIds,
  getInternalPath,
  getDisplayPath,
};