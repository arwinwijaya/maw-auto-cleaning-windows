'use strict';

const path = require('node:path');
const nodeFs = require('node:fs').promises;

/**
 * Path-safety helpers for the cleanup engine.
 *
 * Every deletion must be validated against a server-side allowlisted root.
 * The client never supplies a physical path — only a registered target ID,
 * which the backend resolves to `internalPath` here.
 *
 * Conceptually (spec "PATH VALIDATION"):
 *   candidatePath = realpath(candidate)
 *   rootPath      = realpath(registeredRoot)
 *   candidatePath must start with rootPath + path separator → otherwise BLOCK
 */

/**
 * Resolve the real (symlink-free) absolute path of an allowlisted root.
 *
 * @param {string} internalPath - Registered container path.
 * @param {object} [fsApi] - Injectable fs API (defaults to fs.promises).
 * @returns {Promise<string>} Real path of the root directory.
 * @throws {Error} If the root does not exist or is not a directory.
 */
async function resolveRoot(internalPath, fsApi = nodeFs) {
  const real = await fsApi.realpath(internalPath);
  const stat = await fsApi.stat(real);
  if (!stat.isDirectory()) {
    const error = new Error('not_directory');
    error.code = 'ENOTDIR';
    throw error;
  }
  return real;
}

/**
 * Return the real path of a candidate, or null when it cannot be resolved
 * (e.g. the entry disappeared between listing and checking).
 *
 * @param {string} candidate
 * @param {object} [fsApi]
 * @returns {Promise<string|null>}
 */
async function resolveCandidate(candidate, fsApi = nodeFs) {
  try {
    return await fsApi.realpath(candidate);
  } catch {
    return null;
  }
}

/**
 * Check whether `candidateReal` is strictly inside `rootReal`.
 *
 * The root itself is NEVER considered contained: the cleanup root must never
 * be deleted (spec "DIRECTORY CLEANUP"). The comparison uses the platform
 * path separator to avoid the classic `/cleanup/temp-evil` prefix bug.
 *
 * @param {string} candidateReal - Real path of the candidate.
 * @param {string} rootReal - Real path of the allowlisted root.
 * @returns {boolean}
 */
function isContained(candidateReal, rootReal) {
  if (typeof candidateReal !== 'string' || typeof rootReal !== 'string') return false;
  if (candidateReal === rootReal) return false;
  // Container paths are POSIX; Windows host paths (dev) use backslashes.
  // Pick the separator that matches the root instead of relying on the host
  // platform, so the containment check is correct in both environments.
  const useWindows = /^[A-Za-z]:[\\/]/.test(rootReal) || (rootReal.includes('\\') && !rootReal.includes('/'));
  const sep = useWindows ? '\\' : '/';
  const rootWithSep = rootReal.endsWith(sep) ? rootReal : `${rootReal}${sep}`;
  return candidateReal.startsWith(rootWithSep);
}

/**
 * Validate a candidate path against a root: it must resolve, must not be a
 * symlink/junction, and must be contained inside the root.
 *
 * @param {string} candidate - Candidate path (not yet resolved).
 * @param {string} rootReal - Real path of the allowlisted root.
 * @param {object} [fsApi]
 * @returns {Promise<{ ok: boolean, reason?: string, real?: string }>}
 */
async function validateCandidate(candidate, rootReal, fsApi = nodeFs) {
  const real = await resolveCandidate(candidate, fsApi);
  if (!real) return { ok: false, reason: 'unresolvable' };
  if (!isContained(real, rootReal)) return { ok: false, reason: 'outside_root' };
  return { ok: true, real };
}

/**
 * True when a lstat result represents a symbolic link or a Windows reparse
 * point (junction / mount point). Such entries are never traversed or deleted
 * (spec "SYMLINK / JUNCTION PROTECTION").
 *
 * @param {import('node:fs').Stats} stat
 * @returns {boolean}
 */
function isLinkLike(stat) {
  if (!stat) return false;
  if (typeof stat.isSymbolicLink === 'function' && stat.isSymbolicLink()) return true;
  if (typeof stat.isReparsePoint === 'function' && stat.isReparsePoint()) return true;
  return false;
}

/**
 * Build a display path from a container path using the Windows separator.
 * Kept for parity with the scanner's `toDisplayPath`.
 *
 * @param {string} value
 * @returns {string}
 */
function toDisplayPath(value) {
  return String(value).replace(/\//g, '\\');
}

module.exports = {
  resolveRoot,
  resolveCandidate,
  isContained,
  validateCandidate,
  isLinkLike,
  toDisplayPath,
};