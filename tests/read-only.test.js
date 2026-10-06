'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function walkDirectory(directoryPath) {
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDirectory(entryPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function collectSourceFiles() {
  const explicitFiles = ['Dockerfile', 'docker-compose.yml', 'server.js'];
  const recursiveRoots = [
    { directory: 'lib', extensions: new Set(['.js']) },
    { directory: 'public', extensions: new Set(['.js', '.html']) },
  ];

  const files = explicitFiles.map((relativePath) => path.join(PROJECT_ROOT, relativePath));

  for (const root of recursiveRoots) {
    const directoryPath = path.join(PROJECT_ROOT, root.directory);
    for (const filePath of walkDirectory(directoryPath)) {
      if (root.extensions.has(path.extname(filePath))) {
        files.push(filePath);
      }
    }
  }

  return files
    .map((filePath) => {
      const relativePath = toPosix(path.relative(PROJECT_ROOT, filePath));
      return {
        filePath,
        relativePath,
        content: fs.readFileSync(filePath, 'utf8'),
      };
    })
    .sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
}

function findMatches(files, patterns) {
  const matches = [];

  for (const file of files) {
    for (const pattern of patterns) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags.includes('g') ? pattern.regex.flags : `${pattern.regex.flags}g`);
      let match;
      while ((match = regex.exec(file.content)) !== null) {
        matches.push({
          file: file.relativePath,
          pattern: pattern.name,
          match: match[0],
        });
        if (match[0].length === 0) {
          regex.lastIndex += 1;
        }
      }
    }
  }

  return matches;
}

const READ_ONLY_SOURCES = collectSourceFiles();

const FORBIDDEN_SOURCE_PATTERNS = [
  { name: 'fs.writeFile', regex: /\bfs\s*\.\s*writeFile\s*\(/ },
  { name: 'fs.writeFileSync', regex: /\bfs\s*\.\s*writeFileSync\s*\(/ },
  { name: 'fs.appendFileSync', regex: /\bfs\s*\.\s*appendFileSync\s*\(/ },
  { name: 'child_process.spawn call', regex: /\b(?:child_process\s*\.\s*)?spawn\s*\(/ },
  { name: 'child_process.spawnSync call', regex: /\b(?:child_process\s*\.\s*)?spawnSync\s*\(/ },
  { name: 'child_process.exec call', regex: /\b(?:child_process\s*\.\s*)?exec\s*\(/ },
  { name: 'child_process.execSync call', regex: /\b(?:child_process\s*\.\s*)?execSync\s*\(/ },
  { name: 'child_process destructive import', regex: /\{[^}]*\b(?:spawn|spawnSync|exec|execSync)\b[^}]*\}\s*=\s*require\(\s*['"]node:child_process['"]\s*\)/ },
  { name: 'child_process destructive import', regex: /\{[^}]*\b(?:spawn|spawnSync|exec|execSync)\b[^}]*\}\s*=\s*require\(\s*['"]child_process['"]\s*\)/ },
];

const CONTAINER_DESTRUCTIVE_PATTERNS = [
  { name: 'container rm -rf', regex: /\brm\s+-rf\b/i },
  { name: 'container rm -r', regex: /\brm\s+-[a-z]*r[a-z]*\b/i },
  { name: 'container del command', regex: /(^|[&|()\s])del\s+/i },
  { name: 'container erase command', regex: /(^|[&|()\s])erase\s+/i },
  { name: 'container rmdir command', regex: /\brmdir\b/i },
  { name: 'container deltree command', regex: /\bdeltree\b/i },
  { name: 'compose privileged mode', regex: /\bprivileged:\s*true\b/i },
];

const PUBLIC_PROCESS_PATTERNS = [
  { name: 'public child_process module', regex: /\bchild_process\b/ },
  { name: 'public execFile call', regex: /\bexecFile\s*\(/ },
  { name: 'public spawn call', regex: /\bspawn\s*\(/ },
  { name: 'public spawnSync call', regex: /\bspawnSync\s*\(/ },
  { name: 'public exec call', regex: /\bexec\s*\(/ },
  { name: 'public execSync call', regex: /\bexecSync\s*\(/ },
];

describe('read-only static analysis guard', () => {
  it('inspects the expected source files and non-empty forbidden pattern lists', () => {
    const inspectedPaths = READ_ONLY_SOURCES.map((file) => file.relativePath);

    assert.ok(FORBIDDEN_SOURCE_PATTERNS.length > 0, 'forbidden source pattern list must not be empty');
    assert.ok(CONTAINER_DESTRUCTIVE_PATTERNS.length > 0, 'container destructive pattern list must not be empty');
    assert.ok(PUBLIC_PROCESS_PATTERNS.length > 0, 'public process pattern list must not be empty');
    assert.deepEqual(inspectedPaths, [
      'Dockerfile',
      'docker-compose.yml',
      'lib/cleanup-engine.js',
      'lib/cleanup-jobs.js',
      'lib/cleanup-targets.js',
      'lib/concurrency.js',
      'lib/format.js',
      'lib/resolve-temp.js',
      'lib/safe-path.js',
      'public/app.js',
      'public/index.html',
      'server.js',
    ]);

    const server = READ_ONLY_SOURCES.find((file) => file.relativePath === 'server.js');
    const app = READ_ONLY_SOURCES.find((file) => file.relativePath === 'public/app.js');
    assert.ok(server && server.content.includes('/api/scan'), 'server.js contents must be read and inspected');
    assert.ok(app && app.content.includes("fetch('/api/scan')"), 'public/app.js contents must be read and inspected');
  });

  it('has zero forbidden write, delete, spawn, exec, or execSync patterns in source files', () => {
    const matches = findMatches(READ_ONLY_SOURCES, FORBIDDEN_SOURCE_PATTERNS);
    assert.deepEqual(matches, []);
  });

  it('only writes to the container-local audit log, never to host mounts', () => {
    const appendMatches = findMatches(READ_ONLY_SOURCES, [
      { name: 'fs.appendFile', regex: /\bfs\s*\.\s*appendFile\s*\(/ },
    ]);
    assert.deepEqual(appendMatches, [
      { file: 'server.js', pattern: 'fs.appendFile', match: 'fs.appendFile(' },
    ]);

    const server = READ_ONLY_SOURCES.find((file) => file.relativePath === 'server.js');
    assert.match(server.content, /CLEANUP_AUDIT_FILE/);
    assert.match(server.content, /\/tmp\/cleanup-audit\.jsonl/);
    assert.doesNotMatch(server.content, /appendFile\([\s\S]{0,120}\/mnt\//);
  });

  it('keeps Dockerfile and docker-compose.yml free of destructive commands', () => {
    const dockerfile = READ_ONLY_SOURCES.find((file) => file.relativePath === 'Dockerfile');
    const compose = READ_ONLY_SOURCES.find((file) => file.relativePath === 'docker-compose.yml');
    assert.ok(dockerfile, 'Dockerfile must be inspected');
    assert.ok(compose, 'docker-compose.yml must be inspected');

    const matches = findMatches([dockerfile, compose], CONTAINER_DESTRUCTIVE_PATTERNS);
    assert.deepEqual(matches, []);
  });

  it('mounts the host drive read-only and keeps container hardening', () => {
    const compose = READ_ONLY_SOURCES.find((file) => file.relativePath === 'docker-compose.yml');
    const dockerfile = READ_ONLY_SOURCES.find((file) => file.relativePath === 'Dockerfile');
    assert.ok(compose, 'docker-compose.yml must be inspected');
    assert.ok(dockerfile, 'Dockerfile must be inspected');

    // Host bind mount read-only
    assert.match(compose.content, /read_only:\s*true/);
    assert.match(compose.content, /target:\s*\/mnt\/c/);
    // Root filesystem read-only with writable tmpfs
    assert.match(compose.content, /^\s*read_only:\s*true/m);
    assert.match(compose.content, /no-new-privileges:true/);
    assert.doesNotMatch(compose.content, /privileged:\s*true/i);
    assert.match(compose.content, /127\.0\.0\.1:3456:3456/);
    assert.match(dockerfile.content, /USER\s+node\b/);
    assert.match(dockerfile.content, /EXPOSE\s+3456\b/);
  });

  it('allows only the documented read-only registry query via execFile', () => {
    const execFileMatches = findMatches(READ_ONLY_SOURCES, [
      { name: 'execFile invocation', regex: /\bexecFile\s*\(/ },
    ]);

    assert.deepEqual(execFileMatches, [
      {
        file: 'lib/resolve-temp.js',
        pattern: 'execFile invocation',
        match: 'execFile(',
      },
    ]);
  });

  it('exposes no unauthorized delete route, explorer-opening affordance, or public process execution', () => {
    const server = READ_ONLY_SOURCES.find((file) => file.relativePath === 'server.js');
    const publicFiles = READ_ONLY_SOURCES.filter((file) => file.relativePath.startsWith('public/'));

    assert.ok(server, 'server.js must be inspected');
    assert.doesNotMatch(server.content, /['"`]\/api\/delete\b/);

    const explorerAffordanceMatches = findMatches(READ_ONLY_SOURCES, [
      { name: 'Open in Explorer affordance', regex: /\bOpen\s+in\s+Explorer\b/i },
      { name: 'openExplorer affordance', regex: /\bopenExplorer\b/ },
      { name: 'explorer.exe affordance', regex: /\bexplorer\.exe\b/i },
    ]);
    assert.deepEqual(explorerAffordanceMatches, []);

    const publicProcessMatches = findMatches(publicFiles, PUBLIC_PROCESS_PATTERNS);
    assert.deepEqual(publicProcessMatches, []);
  });
});
