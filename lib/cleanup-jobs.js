'use strict';

const crypto = require('node:crypto');

/**
 * Cleanup job manager — handles async job lifecycle, per-target concurrency,
 * confirmation tokens (short-lived, single-use), and progress polling.
 *
 * Spec "CONCURRENT SAFETY": 409 Conflict if same target already being cleaned.
 * Spec "DRY RUN FIRST": confirmation token from preview gates execute.
 */

/** @type {Map<string, Job>} */
const jobs = new Map();

/** @type {Map<string, string>} Active target -> jobId */
const targetLocks = new Map();

/** @type {Map<string, { targets: string[], expiresAt: number }>} */
const confirmationTokens = new Map();

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes
const JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes after completion

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Create a short-lived confirmation token from a preview result.
 * @param {string[]} targetIds
 * @returns {string} Token string.
 */
function createConfirmationToken(targetIds) {
  const token = generateId();
  confirmationTokens.set(token, {
    targets: [...targetIds].sort().join(','),
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });
  return token;
}

/**
 * Validate and consume a confirmation token.
 * @param {string} token
 * @param {string[]} targetIds
 * @returns {boolean} True if valid and consumed.
 */
function consumeConfirmationToken(token, targetIds) {
  const record = confirmationTokens.get(token);
  if (!record) return false;
  if (Date.now() > record.expiresAt) {
    confirmationTokens.delete(token);
    return false;
  }
  const expected = [...targetIds].sort().join(',');
  if (record.targets !== expected) return false;
  confirmationTokens.delete(token); // single-use
  return true;
}

/**
 * Check if any target is already locked by another job.
 * @param {string[]} targetIds
 * @returns {string|null} The conflicting target ID, or null.
 */
function checkTargetLocks(targetIds) {
  for (const id of targetIds) {
    if (targetLocks.has(id)) return id;
  }
  return null;
}

/**
 * Acquire locks for targets.
 * @param {string[]} targetIds
 * @param {string} jobId
 */
function acquireLocks(targetIds, jobId) {
  for (const id of targetIds) {
    targetLocks.set(id, jobId);
  }
}

/**
 * Release locks for targets.
 * @param {string[]} targetIds
 */
function releaseLocks(targetIds) {
  for (const id of targetIds) {
    targetLocks.delete(id);
  }
}

/**
 * Create a new cleanup job.
 * @param {string[]} targetIds
 * @returns {{ jobId: string, conflictTarget?: string }}
 */
function createJob(targetIds) {
  const conflict = checkTargetLocks(targetIds);
  if (conflict) {
    return { jobId: null, conflictTarget: conflict };
  }
  const jobId = generateId();
  acquireLocks(targetIds, jobId);
  const job = {
    jobId,
    targetIds: [...targetIds],
    status: 'queued',
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
    progress: {
      processedFiles: 0,
      totalFiles: 0,
      bytesDeleted: 0,
      currentTarget: null,
    },
    result: null,
    error: null,
    abortController: new AbortController(),
  };
  jobs.set(jobId, job);
  return { jobId, conflictTarget: null };
}

/**
 * Get a job by ID.
 * @param {string} jobId
 * @returns {Job|undefined}
 */
function getJob(jobId) {
  return jobs.get(jobId);
}

/**
 * Update job progress.
 * @param {string} jobId
 * @param {object} delta
 */
function updateProgress(jobId, delta) {
  const job = jobs.get(jobId);
  if (!job) return;
  if (delta.processedFiles !== undefined) job.progress.processedFiles += delta.processedFiles;
  if (delta.totalFiles !== undefined) job.progress.totalFiles = delta.totalFiles;
  if (delta.bytesDeleted !== undefined) job.progress.bytesDeleted += delta.bytesDeleted;
  if (delta.currentTarget !== undefined) job.progress.currentTarget = delta.currentTarget;
  if (delta.status !== undefined) job.status = delta.status;
  if (delta.startedAt !== undefined) job.startedAt = delta.startedAt;
  if (delta.completedAt !== undefined) job.completedAt = delta.completedAt;
  if (delta.result !== undefined) job.result = delta.result;
  if (delta.error !== undefined) job.error = delta.error;
}

/**
 * Mark job as running.
 * @param {string} jobId
 */
function startJob(jobId) {
  updateProgress(jobId, { status: 'running', startedAt: Date.now() });
}

/**
 * Mark job as completed.
 * @param {string} jobId
 * @param {object} result
 */
function completeJob(jobId, result) {
  updateProgress(jobId, { status: 'completed', completedAt: Date.now(), result });
  releaseLocks(jobs.get(jobId)?.targetIds ?? []);
}

/**
 * Mark job as failed.
 * @param {string} jobId
 * @param {Error|string} error
 */
function failJob(jobId, error) {
  const msg = error instanceof Error ? error.message : String(error);
  updateProgress(jobId, { status: 'failed', completedAt: Date.now(), error: msg });
  releaseLocks(jobs.get(jobId)?.targetIds ?? []);
}

/**
 * Mark job as cancelled.
 * @param {string} jobId
 */
function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return false;
  if (job.status === 'running' || job.status === 'queued') {
    job.abortController.abort();
    updateProgress(jobId, { status: 'cancelled', completedAt: Date.now() });
    releaseLocks(job.targetIds);
    return true;
  }
  return false;
}

/**
 * Get a summary of a job for polling.
 * @param {string} jobId
 * @returns {object|null}
 */
function getJobSummary(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  return {
    jobId: job.jobId,
    status: job.status,
    targetIds: job.targetIds,
    progress: { ...job.progress },
    result: job.result,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  };
}

/**
 * Clean up old jobs (TTL-based). Call periodically.
 */
function cleanupOldJobs() {
  const now = Date.now();
  for (const [jobId, job] of jobs.entries()) {
    if (job.completedAt && now - job.completedAt > JOB_TTL_MS) {
      releaseLocks(job.targetIds);
      jobs.delete(jobId);
    }
  }
  // Also clean expired tokens
  for (const [token, record] of confirmationTokens.entries()) {
    if (now > record.expiresAt) confirmationTokens.delete(token);
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupOldJobs, 5 * 60 * 1000).unref();

module.exports = {
  jobs,
  targetLocks,
  confirmationTokens,
  createConfirmationToken,
  consumeConfirmationToken,
  checkTargetLocks,
  acquireLocks,
  releaseLocks,
  createJob,
  getJob,
  getJobSummary,
  updateProgress,
  startJob,
  completeJob,
  failJob,
  cancelJob,
  cleanupOldJobs,
};