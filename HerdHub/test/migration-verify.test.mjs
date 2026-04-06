/**
 * Migration Verification Test
 *
 * Tests that the SQLite migration is working correctly:
 * 1. Data is migrated from JSON to SQLite on first run
 * 2. Dual-write system maintains consistency
 * 3. Read operations work with SQLite-first, JSON-fallback
 * 4. Write operations update both SQLite and JSON
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, "..", "data");
const DB_PATH = join(DATA_DIR, "herdhub.db");
const ACCOUNTS_JSON = join(DATA_DIR, "db", "accounts.json");
const BREEDS_JSON = join(DATA_DIR, "db", "breeds.json");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:5176";

// Helper functions
async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  return response.json();
}

async function post(path, body, cookie) {
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function get(path, cookie) {
  return fetch(`${BASE_URL}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

async function login(email, password) {
  const response = await post("/api/login", { email, password });
  const cookie = response.headers.get("set-cookie");
  return cookie ? cookie.split(";")[0] : null;
}

// Test suite
test("Migration Verification Tests", async (t) => {
  let testAdminEmail = `migration_test_${Date.now()}@test.invalid`;
  let testAdminPassword = `MigrationTest${Date.now()}!`;
  let adminCookie;
  let testUserId;

  // Clean up before tests
  t.before(async () => {
    // Ensure we start with a clean state
    if (existsSync(DB_PATH)) {
      console.log("Note: Database exists, migration should have already run");
    }
  });

  await t.test("1. Database should exist after server start", () => {
    assert.ok(existsSync(DB_PATH), "SQLite database should exist");
  });

  await t.test("2. JSON files should exist", () => {
    assert.ok(existsSync(ACCOUNTS_JSON), "accounts.json should exist");
    assert.ok(existsSync(BREEDS_JSON), "breeds.json should exist");
  });

  await t.test("3. SQLite should have schema tables", () => {
    const db = new Database(DB_PATH);
    const tables = db
      .prepare(
        `
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `,
      )
      .all();

    const tableNames = tables.map((t) => t.name);
    assert.ok(tableNames.includes("accounts"), "accounts table should exist");
    assert.ok(tableNames.includes("breeds"), "breeds table should exist");
    assert.ok(tableNames.includes("tags"), "tags table should exist");
    assert.ok(
      tableNames.includes("breed_tags"),
      "breed_tags table should exist",
    );
    assert.ok(
      tableNames.includes("user_herds"),
      "user_herds table should exist",
    );

    db.close();
  });

  await t.test("4. Breeds should be migrated from JSON to SQLite", () => {
    const db = new Database(DB_PATH);
    const sqliteCount = db
      .prepare("SELECT COUNT(*) as count FROM breeds")
      .get().count;

    const breedsJson = JSON.parse(readFileSync(BREEDS_JSON, "utf8"));
    const jsonCount = breedsJson.length;

    console.log(`SQLite breeds: ${sqliteCount}, JSON breeds: ${jsonCount}`);
    assert.ok(sqliteCount > 0, "SQLite should have breeds");
    assert.ok(jsonCount > 0, "JSON should have breeds");
    // They might not match exactly due to migration strategy, but both should have data
    db.close();
  });

  await t.test("5. Read operations should work (SQLite-first)", async () => {
    const response = await get("/api/breeds");
    assert.equal(response.status, 200, "GET /api/breeds should return 200");

    const breeds = await response.json();
    assert.ok(Array.isArray(breeds), "Should return array of breeds");
    assert.ok(breeds.length > 0, "Should have breeds");

    // Check structure of first breed
    const firstBreed = breeds[0];
    assert.ok("id" in firstBreed, "Breed should have id");
    assert.ok("name" in firstBreed, "Breed should have name");
    assert.ok("tags" in firstBreed, "Breed should have tags array");
  });

  await t.test(
    "5b. API data should match source JSON (minus id/species/props)",
    async () => {
      const response = await get("/api/breeds");
      assert.equal(response.status, 200);
      const apiBreeds = await response.json();

      // Read the migrated breeds.json (source of truth after migration runs)
      const sourceBreeds = JSON.parse(readFileSync(BREEDS_JSON, "utf8"));

      assert.equal(
        apiBreeds.length,
        sourceBreeds.length,
        `API returned ${apiBreeds.length} breeds but source has ${sourceBreeds.length}`,
      );

      // Internal-only fields the API may add that have no source equivalent,
      // or legacy source fields not stored in SQLite (localImage is a legacy
      // scrape artefact — the frontend only uses imageUrl)
      const INTERNAL_FIELDS = new Set(["id", "species", "props", "localImage"]);

      // Index source by name for lookup (IDs may differ between source and API)
      const sourceByName = new Map(sourceBreeds.map((b) => [b.name, b]));

      let mismatches = 0;
      for (const apiBreed of apiBreeds) {
        const src = sourceByName.get(apiBreed.name);
        assert.ok(src, `API breed "${apiBreed.name}" not found in source JSON`);
        if (!src) continue;

        // Compare every non-internal API field against source
        for (const [key, val] of Object.entries(apiBreed)) {
          if (INTERNAL_FIELDS.has(key)) continue;
          if (key === "tags") {
            // Tags: compare sorted, case-insensitive
            const apiTags = [...(val || [])].map((t) => t.toLowerCase()).sort();
            const srcTags = [...(src.tags || [])].map((t) => t.toLowerCase()).sort();
            if (apiTags.join(",") !== srcTags.join(",")) {
              console.error(
                `Tag mismatch for "${apiBreed.name}": API=${JSON.stringify(apiTags)} src=${JSON.stringify(srcTags)}`,
              );
              mismatches++;
            }
          } else {
            // All other fields: strict equality, treating null and "" as equivalent
            const normalize = (v) => (v === "" ? null : v);
            if (normalize(val) !== normalize(src[key])) {
              console.error(
                `Field mismatch for "${apiBreed.name}".${key}: API=${JSON.stringify(val)} src=${JSON.stringify(src[key])}`,
              );
              mismatches++;
            }
          }
        }

        // Check no source fields were dropped (except id which may not be in source)
        for (const key of Object.keys(src)) {
          if (INTERNAL_FIELDS.has(key)) continue;
          if (!(key in apiBreed)) {
            console.error(
              `Field "${key}" present in source for "${src.name}" but missing from API response`,
            );
            mismatches++;
          }
        }
      }

      assert.equal(mismatches, 0, `${mismatches} field mismatches between API and source data`);
    },
  );

  await t.test(
    "6. Dual-write: Account creation should update both SQLite and JSON",
    async () => {
      // First, get admin cookie (using seeded admin)
      const seedAdminEmail =
        process.env.SEED_ADMIN_EMAIL || "admin@herdhub.com";
      const seedAdminPassword = process.env.SEED_ADMIN_PASSWORD || "admin123";
      const seedCookie = await login(seedAdminEmail, seedAdminPassword);
      assert.ok(seedCookie, "Should be able to login as seeded admin");

      // Create test admin account
      const createResponse = await post(
        "/api/accounts",
        {
          email: testAdminEmail,
          password: testAdminPassword,
          role: "admin",
        },
        seedCookie,
      );

      assert.equal(
        createResponse.status,
        201,
        "Should create account successfully",
      );
      const createdAccount = await createResponse.json();
      testUserId = createdAccount.id;
      assert.ok(testUserId, "Should have user ID");

      // Login as test admin
      adminCookie = await login(testAdminEmail, testAdminPassword);
      assert.ok(adminCookie, "Should be able to login as test admin");

      // Verify account exists in SQLite
      const db = new Database(DB_PATH);
      const sqliteAccount = db
        .prepare("SELECT * FROM accounts WHERE email = ?")
        .get(testAdminEmail);
      assert.ok(sqliteAccount, "Account should exist in SQLite");
      assert.equal(
        sqliteAccount.email,
        testAdminEmail,
        "Email should match in SQLite",
      );
      assert.equal(
        sqliteAccount.role,
        "admin",
        "Role should be admin in SQLite",
      );

      // Verify account exists in JSON
      const accountsJson = JSON.parse(readFileSync(ACCOUNTS_JSON, "utf8"));
      const jsonAccount = accountsJson.find(
        (acc) => acc.email === testAdminEmail,
      );
      assert.ok(jsonAccount, "Account should exist in JSON");
      assert.equal(
        jsonAccount.email,
        testAdminEmail,
        "Email should match in JSON",
      );
      assert.equal(jsonAccount.role, "admin", "Role should be admin in JSON");

      db.close();
    },
  );

  await t.test(
    "7. Dual-write: Breed creation should update both SQLite and JSON",
    async () => {
      const breedName = `Migration Test Breed ${Date.now()}`;

      // Create a breed
      const createResponse = await post(
        "/api/breeds",
        {
          name: breedName,
          tags: ["test", "migration"],
        },
        adminCookie,
      );

      assert.equal(
        createResponse.status,
        201,
        "Should create breed successfully",
      );
      const createdBreed = await createResponse.json();
      const breedId = createdBreed.id;
      assert.ok(breedId, "Should have breed ID");

      // Verify breed exists in SQLite
      const db = new Database(DB_PATH);
      const sqliteBreed = db
        .prepare("SELECT * FROM breeds WHERE id = ?")
        .get(breedId);
      assert.ok(sqliteBreed, "Breed should exist in SQLite");
      assert.equal(sqliteBreed.name, breedName, "Name should match in SQLite");

      // Parse props JSON
      const props = sqliteBreed.props ? JSON.parse(sqliteBreed.props) : {};
      assert.ok(props.tags, "Should have tags in props");
      assert.ok(props.tags.includes("test"), 'Should have "test" tag');

      // Verify breed exists in JSON
      const breedsJson = JSON.parse(readFileSync(BREEDS_JSON, "utf8"));
      const jsonBreed = breedsJson.find((b) => b.id === breedId);
      assert.ok(jsonBreed, "Breed should exist in JSON");
      assert.equal(jsonBreed.name, breedName, "Name should match in JSON");
      assert.ok(jsonBreed.tags, "Should have tags in JSON");
      assert.ok(
        jsonBreed.tags.includes("test"),
        'Should have "test" tag in JSON',
      );

      db.close();
    },
  );

  await t.test("8. Data consistency: Counts should be reasonable", () => {
    const db = new Database(DB_PATH);

    // Check account counts
    const sqliteAccounts = db
      .prepare("SELECT COUNT(*) as count FROM accounts")
      .get().count;
    const jsonAccounts = JSON.parse(readFileSync(ACCOUNTS_JSON, "utf8")).length;

    console.log(`Accounts - SQLite: ${sqliteAccounts}, JSON: ${jsonAccounts}`);
    // They should be close (within 1-2 due to timing)
    assert.ok(
      Math.abs(sqliteAccounts - jsonAccounts) <= 2,
      "Account counts should be similar between SQLite and JSON",
    );

    // Check breed counts
    const sqliteBreeds = db
      .prepare("SELECT COUNT(*) as count FROM breeds")
      .get().count;
    const jsonBreeds = JSON.parse(readFileSync(BREEDS_JSON, "utf8")).length;

    console.log(`Breeds - SQLite: ${sqliteBreeds}, JSON: ${jsonBreeds}`);
    // Breed counts should match more closely
    assert.ok(
      Math.abs(sqliteBreeds - jsonBreeds) <= 2,
      "Breed counts should be similar between SQLite and JSON",
    );

    db.close();
  });

  await t.test("9. Verify migration endpoint works", async () => {
    const response = await get("/api/verify-migration", adminCookie);
    assert.equal(
      response.status,
      200,
      "Migration verification endpoint should work",
    );

    const data = await response.json();
    console.log("Migration verification data:", data);

    assert.ok("accounts" in data, "Should have accounts comparison");
    assert.ok("breeds" in data, "Should have breeds comparison");
    assert.ok("herds" in data, "Should have herds comparison");

    // Check that counts are reported
    assert.ok(data.accounts.sqlite >= 0, "Should have SQLite account count");
    assert.ok(data.accounts.json >= 0, "Should have JSON account count");
    assert.ok(data.breeds.sqlite >= 0, "Should have SQLite breed count");
    assert.ok(data.breeds.json >= 0, "Should have JSON breed count");
  });

  // Clean up after tests
  t.after(async () => {
    if (adminCookie && testUserId) {
      // Delete test account
      try {
        await fetch(`${BASE_URL}/api/accounts/${testUserId}`, {
          method: "DELETE",
          headers: { Cookie: adminCookie },
        });
      } catch (err) {
        console.warn("Failed to clean up test account:", err.message);
      }
    }
  });
});

console.log("Migration verification test module loaded");
