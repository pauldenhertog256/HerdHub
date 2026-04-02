#!/usr/bin/env node
/**
 * HerdHub — Production Data Backup Script
 *
 * Authenticates as admin via HTTP and downloads the full data/ folder
 * as a tar.gz from the /api/admin/backup endpoint.
 *
 * Usage:
 *   node scripts/backup-production.mjs
 *
 * Env vars (or set in .env):
 *   BASE_URL      - Production URL (default: https://herdhub-production-7da5.up.railway.app)
 *   BACKUP_USER   - Admin email for authentication
 *   BACKUP_PASS   - Admin password for authentication
 *
 * Output: backups/herdhub-backup-YYYY-MM-DD_HH-mm-ss.tar.gz
 */

import { config } from 'dotenv';
import { createWriteStream, mkdirSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env file from project root
config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const BACKUP_DIR = join(PROJECT_ROOT, 'backups');

const BASE_URL = process.env.BASE_URL || 'https://herdhub-production-7da5.up.railway.app';
const BACKUP_USER = process.env.BACKUP_USER;
const BACKUP_PASS = process.env.BACKUP_PASS;

function getTimestamp() {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function log(msg) { console.log(msg); }

async function main() {
  log('🚀 HerdHub Production Backup (HTTP)');
  log(`📡 Target: ${BASE_URL}`);

  if (!BACKUP_USER || !BACKUP_PASS) {
    log('❌ Missing BACKUP_USER or BACKUP_PASS in .env or environment.');
    process.exit(1);
  }

  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

  const timestamp = getTimestamp();
  const filename = `herdhub-backup-${timestamp}.tar.gz`;
  const outputPath = join(BACKUP_DIR, filename);

  try {
    // 1. Login
    log('🔑 Authenticating...');
    const loginRes = await fetch(`${BASE_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: BACKUP_USER, password: BACKUP_PASS }),
    });

    if (!loginRes.ok) {
      const err = await loginRes.text();
      throw new Error(`Login failed (${loginRes.status}): ${err}`);
    }

    // Extract session cookie
    const rawCookie = loginRes.headers.get('set-cookie');
    const sessionCookie = rawCookie?.split(',').find(c => c.trim().startsWith('connect.sid='))?.split(';')[0];
    if (!sessionCookie) throw new Error('No session cookie received from login.');

    log('✅ Authenticated successfully.');

    // 2. Download backup
    log('📥 Downloading backup...');
    const backupRes = await fetch(`${BASE_URL}/api/admin/backup`, {
      headers: { Cookie: sessionCookie },
    });

    if (!backupRes.ok) {
      throw new Error(`Backup request failed (${backupRes.status}): ${await backupRes.text()}`);
    }

    const contentLength = parseInt(backupRes.headers.get('content-length') || '0', 10);
    const writer = createWriteStream(outputPath);
    let downloaded = 0;

    for await (const chunk of backupRes.body) {
      downloaded += chunk.length;
      writer.write(chunk);
      if (contentLength > 0) {
        const pct = Math.round((downloaded / contentLength) * 100);
        process.stdout.write(`\r📥 ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} MB)`);
      } else {
        process.stdout.write(`\r📥 ${(downloaded / 1024 / 1024).toFixed(1)} MB`);
      }
    }
    process.stdout.write('\n');
    writer.end();

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    const size = statSync(outputPath).size;
    log(`✅ Backup saved: ${filename}`);
    log(`📁 Location: ${outputPath}`);
    log(`📊 Size: ${(size / 1024 / 1024).toFixed(2)} MB`);

  } catch (error) {
    log(`❌ Backup failed: ${error.message}`);
    if (existsSync(outputPath)) unlinkSync(outputPath);
    process.exit(1);
  }
}

main();
