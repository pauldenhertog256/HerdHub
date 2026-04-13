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

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const isE2E = process.argv.includes("--e2e");
const SERVER_PORT = process.env.PORT || 5176;
const VITE_PORT = 5175;
const BASE_URL = `http://localhost:${SERVER_PORT}`;
const TEST_SCRIPT = isE2E
  ? null
  : process.argv.slice(2).find((a) => !a.startsWith("--")) ||
    "test/accounts.test.mjs";

// Clean up test data before running tests
async function cleanupTestData() {
  console.log("🧹 Cleaning up test data before tests...");
  try {
    // Delete SQLite database if it exists
    const { existsSync, unlinkSync, readdirSync, rmSync } = await import("fs");
    const { join } = await import("path");
    const { fileURLToPath } = await import("url");
    const __dirname = fileURLToPath(new URL(".", import.meta.url));
    const DATA_DIR = process.env.DATA_DIR || join(__dirname, "..", "data");
    const DB_PATH = join(DATA_DIR, "herdhub.db");

    // Retry deletion up to 5 times with 1s delay — on Windows the DB file
    // can stay locked briefly after the previous server process is killed.
    const filesToDelete = [DB_PATH, DB_PATH + "-wal", DB_PATH + "-shm"];
    for (const f of filesToDelete) {
      if (!existsSync(f)) continue;
      let deleted = false;
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          unlinkSync(f);
          deleted = true;
          break;
        } catch (e) {
          if (e.code === "EBUSY" || e.code === "EPERM") {
            console.warn(
              `⏳ DB file locked (attempt ${attempt}/5), retrying in 1s…`,
            );
            await sleep(1000);
          } else {
            throw e;
          }
        }
      }
      if (deleted && f === DB_PATH) console.log("✅ Deleted SQLite database");
      if (!deleted)
        console.warn(
          `⚠️ Could not delete ${f} after 5 attempts — tests may use stale DB`,
        );
    }

    // Clean up test accounts from JSON file
    const accountsPath = join(DATA_DIR, "db", "accounts.json");
    if (existsSync(accountsPath)) {
      const accounts = JSON.parse(
        await import("fs").then((fs) => fs.readFileSync(accountsPath, "utf8")),
      );
      // Get admin email from environment or use default
      const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@herdhub.com";
      // Keep only accounts that are NOT test accounts AND NOT the seeded admin
      const filteredAccounts = accounts.filter(
        (acc) =>
          !acc.email.includes("@test.invalid") &&
          !acc.email.includes("testadmin_") &&
          acc.email !== ADMIN_EMAIL,
      );
      if (filteredAccounts.length !== accounts.length) {
        await import("fs").then((fs) =>
          fs.writeFileSync(
            accountsPath,
            JSON.stringify(filteredAccounts, null, 2),
          ),
        );
        console.log(
          `✅ Cleaned ${accounts.length - filteredAccounts.length} accounts from JSON`,
        );
      }
    }

    // Clean up test user herd directories
    const usersDir = join(DATA_DIR, "db", "users");
    if (existsSync(usersDir)) {
      const testEmails = new Set();

      // Collect test email patterns to match
      const testEmailPatterns = ["@test.invalid", "testadmin_"];

      // Also check accounts.json for test emails to get their base64 encoded versions
      if (existsSync(accountsPath)) {
        const accounts = JSON.parse(
          await import("fs").then((fs) =>
            fs.readFileSync(accountsPath, "utf8"),
          ),
        );
        accounts.forEach((acc) => {
          if (
            acc.email.includes("@test.invalid") ||
            acc.email.includes("testadmin_")
          ) {
            testEmails.add(acc.email);
          }
        });
      }

      let cleanedDirs = 0;
      const userFolders = readdirSync(usersDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      for (const folder of userFolders) {
        let shouldDelete = false;

        // Try to decode folder name to check if it's a test email
        try {
          const decodedEmail = Buffer.from(
            folder.replace(/-/g, "+").replace(/_/g, "/"),
            "base64",
          ).toString("utf8");
          if (
            decodedEmail.includes("@test.invalid") ||
            decodedEmail.includes("testadmin_")
          ) {
            shouldDelete = true;
          }
        } catch {
          // If we can't decode it, check if folder name looks like base64 of test pattern
          // Test emails often have patterns we can detect
          try {
            // Try base64url decoding
            const decodedEmail = Buffer.from(folder, "base64url").toString(
              "utf8",
            );
            if (
              decodedEmail.includes("@test.invalid") ||
              decodedEmail.includes("testadmin_")
            ) {
              shouldDelete = true;
            }
          } catch {
            // Can't decode, skip
          }
        }

        if (shouldDelete) {
          const dirPath = join(usersDir, folder);
          rmSync(dirPath, { recursive: true, force: true });
          cleanedDirs++;
        }
      }

      if (cleanedDirs > 0) {
        console.log(`✅ Cleaned ${cleanedDirs} test user directories`);
      }
    }
  } catch (err) {
    console.warn("⚠️ Cleanup warning:", err.message);
  }
}

// Environment variables for the server
const serverEnv = {
  ...process.env,
  NODE_ENV: "test",
  SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD || "admin123",
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || "admin@herdhub.com",
  ADMIN_PASS:
    process.env.ADMIN_PASS || process.env.SEED_ADMIN_PASSWORD || "admin123",
};

async function waitForServer(url, maxAttempts = 20, delayMs = 500) {
  console.log(`Waiting for server at ${url}...`);
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${url}/api/breeds`, { method: "HEAD" });
      if (res.ok || res.status === 200) {
        console.log("✅ Server is ready!");
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await sleep(delayMs);
  }
  console.error("❌ Server failed to start within timeout.");
  return false;
}

async function waitForVite(url, maxAttempts = 20, delayMs = 500) {
  console.log(`Waiting for Vite at ${url}...`);
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (res.ok || res.status === 200) {
        console.log("✅ Vite is ready!");
        return true;
      }
    } catch {
      // Vite not ready yet
    }
    await sleep(delayMs);
  }
  console.error("❌ Vite failed to start within timeout.");
  return false;
}

async function main() {
  console.log("=== HerdHub Test Runner ===");
  console.log(`Mode: ${isE2E ? "E2E (Playwright)" : "Unit Tests"}`);
  if (TEST_SCRIPT) console.log(`Test script: ${TEST_SCRIPT}`);
  console.log(`Server port: ${SERVER_PORT}`);

  // Clean up test data before starting
  await cleanupTestData();

  const processes = [];

  // 1. Start backend server
  console.log("\n[1/3] Starting backend server...");
  const server = spawn("node", ["server.js"], {
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
    cwd: process.cwd(),
  });
  processes.push({ name: "server", proc: server });

  server.stdout.on("data", (data) => {
    const msg = data.toString().trim();
    if (msg) console.log(`  [server] ${msg}`);
  });

  server.stderr.on("data", (data) => {
    const msg = data.toString().trim();
    if (msg) {
      // Filter out expected warnings that shouldn't be shown as errors
      if (
        msg.includes("[AUTH] Failed login for:") ||
        msg.includes("Input file contains unsupported image format")
      ) {
        // These are expected warnings, not errors
        console.log(`  [server warn] ${msg}`);
      } else {
        console.error(`  [server error] ${msg}`);
      }
    }
  });

  // Wait for server to be ready
  const serverReady = await waitForServer(BASE_URL);
  if (!serverReady) {
    processes.forEach((p) => p.proc.kill());
    process.exit(1);
  }

  // 2. Start Vite for E2E tests
  if (isE2E) {
    console.log("\n[2/4] Starting Vite dev server...");
    const viteBin = path.join(
      projectRoot,
      "node_modules",
      "vite",
      "bin",
      "vite.js",
    );
    const vite = spawn("node", [viteBin], {
      env: serverEnv,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
    });
    processes.push({ name: "vite", proc: vite });

    vite.stdout.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) console.log(`  [vite] ${msg}`);
    });

    vite.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) console.error(`  [vite error] ${msg}`);
    });

    const viteReady = await waitForVite(`http://localhost:${VITE_PORT}`);
    if (!viteReady) {
      processes.forEach((p) => p.proc.kill());
      process.exit(1);
    }
  }

  // 3. Run tests
  console.log(`\n[${isE2E ? "3/4" : "2/3"}] Running tests...`);
  return new Promise((resolve) => {
    const testArgs = isE2E
      ? [
          path.join(
            projectRoot,
            "node_modules",
            "@playwright",
            "test",
            "cli.js",
          ),
          "test",
        ]
      : ["--test", "--test-concurrency=1", TEST_SCRIPT];
    const test = spawn("node", testArgs, {
      env: serverEnv,
      stdio: "inherit",
      cwd: process.cwd(),
    });

    test.on("close", async (exitCode) => {
      console.log(`\n[${isE2E ? "4/4" : "3/3"}] Cleaning up...`);
      processes.forEach((p) => {
        p.proc.kill();
        console.log(`${p.name} stopped.`);
      });

      // Clean up test data after tests
      await cleanupTestData();

      if (exitCode === 0) {
        console.log("\n✅ All tests passed!");
      } else {
        console.error(`\n❌ Tests failed with exit code ${exitCode}`);
      }
      resolve(exitCode);
    });
  });
}

main().then((exitCode) => process.exit(exitCode || 0));
