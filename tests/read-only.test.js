'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const RUNTIME_FILES = [
  'server.js',
  'lib/analyzer.js',
  'lib/classifier.js',
  'lib/cleanup-guides.js',
  'lib/concurrency.js',
  'lib/format.js',
  'lib/tree-registry.js',
];

// Patterns that would mean the app can mutate the filesystem or spawn a shell.
const FORBIDDEN = [
  { name: 'fs.writeFile', pattern: /\bfs(?:Promises)?\.writeFile\b/ },
  { name: 'fs.appendFile', pattern: /\bfs(?:Promises)?\.appendFile\b/ },
  { name: 'fs.unlink', pattern: /\bfs(?:Promises)?\.unlink\b/ },
  { name: 'fs.rm', pattern: /\bfs(?:Promises)?\.rm\b/ },
  { name: 'fs.rmdir', pattern: /\bfs(?:Promises)?\.rmdir\b/ },
  { name: 'fs.rename', pattern: /\bfs(?:Promises)?\.rename\b/ },
  { name: 'fs.mkdir', pattern: /\bfs(?:Promises)?\.mkdir\b/ },
  { name: 'fs.truncate', pattern: /\bfs(?:Promises)?\.truncate\b/ },
  { name: 'fs.chmod', pattern: /\bfs(?:Promises)?\.chmod\b/ },
  { name: 'child_process', pattern: /require\(['"]node:child_process['"]\)|require\(['"]child_process['"]\)/ },
  { name: 'exec/spawn', pattern: /\b(exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)\s*\(/ },
];

test('runtime code never mutates the filesystem or spawns processes', () => {
  for (const rel of RUNTIME_FILES) {
    const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const { name, pattern } of FORBIDDEN) {
      assert.ok(!pattern.test(source), `${rel} contains forbidden ${name}`);
    }
  }
});

test('server exposes no mutating HTTP routes', () => {
  const source = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  // Only POST routes allowed are scan creation and cancellation.
  const postRoutes = [...source.matchAll(/routePath\s*===\s*'([^']+)'[\s\S]{0,80}?method\s*!==\s*'POST'/g)]
    .map((m) => m[1]);
  for (const route of postRoutes) {
    assert.ok(
      route === '/api/scans' || route.endsWith('/cancel'),
      `unexpected POST route: ${route}`,
    );
  }
  // No write verbs anywhere in the router.
  for (const verb of ['PUT', 'PATCH', 'DELETE']) {
    assert.ok(!new RegExp(`===\\s*'${verb}'`).test(source), `server.js references ${verb}`);
  }
});

test('docker compose mounts every host path read-only', () => {
  const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
  const bindBlocks = compose.split('type: bind').slice(1);
  assert.ok(bindBlocks.length >= 2, 'expected at least two bind mounts');
  for (const block of bindBlocks) {
    const nextMount = block.split('- type: bind')[0];
    assert.match(nextMount, /read_only:\s*true/, 'every bind mount must be read_only: true');
    assert.ok(!/read_only:\s*false/.test(nextMount), 'no writable bind mount allowed');
  }
  assert.ok(!/\/cleanup\//.test(compose), 'cleanup mounts must be removed');
});

test('dockerfile runs as non-root and never deletes', () => {
  const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /USER node/);
  assert.ok(!/\brm\s+-rf\b/.test(dockerfile.replace(/RUN[\s\S]*?\\\n/g, (m) => m)));
});
