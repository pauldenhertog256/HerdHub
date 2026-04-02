#!/usr/bin/env node
/**
 * Cross-platform test runner for HerdHub
 * Starts the server(s), waits for them to be ready, runs tests, then cleans up.
 * Works on Windows, macOS, and Linux without OS-specific dependencies.
 *
 * Usage:
 *   node scripts/test-runner.mjs [test-script]          # Unit tests (default: accounts)
 *   node scripts/test-runner.mjs --e2e                  # Playwright E2E tests
 */

import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const isE2E = process.argv.includes('--e2e');
const SERVER_PORT = process.env.PORT || 5176;
const VITE_PORT = 5175;
const BASE_URL = `http://localhost:${SERVER_PORT}`;
const TEST_SCRIPT = isE2E ? null : (process.argv.slice(2).find(a => !a.startsWith('--')) || 'test/accounts.test.mjs');

// Environment variables for the server
const serverEnv = {
  ...process.env,
  NODE_ENV: 'test',
  SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD || 'admin123',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'pauldenhertog256@gmail.com',
  ADMIN_PASS: process.env.ADMIN_PASS || process.env.SEED_ADMIN_PASSWORD || 'admin123',
};

async function waitForServer(url, maxAttempts = 20, delayMs = 500) {
  console.log(`Waiting for server at ${url}...`);
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${url}/api/breeds`, { method: 'HEAD' });
      if (res.ok || res.status === 200) {
        console.log('✅ Server is ready!');
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await setTimeout(delayMs);
  }
  console.error('❌ Server failed to start within timeout.');
  return false;
}

async function waitForVite(url, maxAttempts = 20, delayMs = 500) {
  console.log(`Waiting for Vite at ${url}...`);
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok || res.status === 200) {
        console.log('✅ Vite is ready!');
        return true;
      }
    } catch {
      // Vite not ready yet
    }
    await setTimeout(delayMs);
  }
  console.error('❌ Vite failed to start within timeout.');
  return false;
}



async function main() {
  console.log('=== HerdHub Test Runner ===');
  console.log(`Mode: ${isE2E ? 'E2E (Playwright)' : 'Unit Tests'}`);
  if (TEST_SCRIPT) console.log(`Test script: ${TEST_SCRIPT}`);
  console.log(`Server port: ${SERVER_PORT}`);

  const processes = [];

  // 1. Start backend server
  console.log('\n[1/3] Starting backend server...');
  const server = spawn('node', ['server.js'], {
    env: serverEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: process.cwd(),
  });
  processes.push({ name: 'server', proc: server });

  server.stdout.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.log(`  [server] ${msg}`);
  });

  server.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.error(`  [server error] ${msg}`);
  });

  // Wait for server to be ready
  const serverReady = await waitForServer(BASE_URL);
  if (!serverReady) {
    processes.forEach(p => p.proc.kill());
    process.exit(1);
  }

  // 2. Start Vite for E2E tests
  if (isE2E) {
    console.log('\n[2/4] Starting Vite dev server...');
    const viteBin = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
    const vite = spawn('node', [viteBin], {
      env: serverEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd(),
    });
    processes.push({ name: 'vite', proc: vite });

    vite.stdout.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.log(`  [vite] ${msg}`);
    });

    vite.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.error(`  [vite error] ${msg}`);
    });

    const viteReady = await waitForVite(`http://localhost:${VITE_PORT}`);
    if (!viteReady) {
      processes.forEach(p => p.proc.kill());
      process.exit(1);
    }
  }

  // 3. Run tests
  console.log(`\n[${isE2E ? '3/4' : '2/3'}] Running tests...`);
  return new Promise((resolve) => {
    const testArgs = isE2E
      ? [path.join(projectRoot, 'node_modules', '@playwright', 'test', 'cli.js'), 'test']
      : ['--test', '--test-concurrency=1', TEST_SCRIPT];
    const test = spawn('node', testArgs, {
      env: serverEnv,
      stdio: 'inherit',
      cwd: process.cwd(),
    });

    test.on('close', (exitCode) => {
      console.log(`\n[${isE2E ? '4/4' : '3/3'}] Cleaning up...`);
      processes.forEach(p => {
        p.proc.kill();
        console.log(`${p.name} stopped.`);
      });

      if (exitCode === 0) {
        console.log('\n✅ All tests passed!');
      } else {
        console.error(`\n❌ Tests failed with exit code ${exitCode}`);
      }
      resolve(exitCode);
    });
  });
}

main().then((exitCode) => process.exit(exitCode || 0));
