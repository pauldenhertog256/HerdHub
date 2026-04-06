import { readFileSync, existsSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Migrates data from flat JSON files to SQLite.
 * Designed to be idempotent and safe to run multiple times.
 *
 * @param {import('better-sqlite3').Database} db - The SQLite database instance
 * @param {string} dataDir - Path to the data directory containing JSON files
 */
export function migrateFromJson(db, dataDir) {
  console.log("🚀 Starting JSON to SQLite migration...");

  const dbDir = join(dataDir, "db");
  const imgDir = join(dataDir, "images");
  const usersDir = join(dbDir, "users");

  // Prepare statements for idempotent insertion
  const insertAccount = db.prepare(`
    INSERT OR IGNORE INTO accounts (id, email, password_hash, role, created_at)
    VALUES (@id, @email, @password_hash, @role, @created_at)
  `);

  const insertBreed = db.prepare(`
    INSERT OR IGNORE INTO breeds (id, species, name, origin, subspecies, image_url, wiki_url, props, created_at, updated_at)
    VALUES (@id, 'cattle', @name, @origin, @subspecies, @image_url, @wiki_url, @props, @created_at, @updated_at)
  `);

  const insertTag = db.prepare(`
    INSERT OR IGNORE INTO tags (name) VALUES (@name)
  `);

  const getTagId = db.prepare(`SELECT id FROM tags WHERE name = ?`);

  const insertBreedTag = db.prepare(`
    INSERT OR IGNORE INTO breed_tags (breed_id, tag_id) VALUES (?, ?)
  `);

  const insertUserHerd = db.prepare(`
    INSERT OR IGNORE INTO user_herds (user_id, breed_id, custom_name, custom_image_url, custom_notes, created_at)
    VALUES (@user_id, @breed_id, @custom_name, @custom_image_url, @custom_notes, @created_at)
  `);

  // 1. Migrate Accounts
  const accountsPath = join(dbDir, "accounts.json");
  if (existsSync(accountsPath)) {
    console.log("📦 Migrating accounts...");
    const accounts = JSON.parse(readFileSync(accountsPath, "utf8"));
    const insertMany = db.transaction((accs) => {
      let nextId = 1;
      accs.forEach((acc) => {
        insertAccount.run({
          id: nextId++,
          email: acc.email,
          password_hash: acc.passwordHash,
          role: acc.role,
          created_at: acc.createdAt || new Date().toISOString(),
        });
      });
    });
    insertMany(accounts);
    console.log(`✅ Migrated ${accounts.length} accounts with sequential IDs`);
  }

  // 2. Migrate Breeds & Tags
  const breedsPath = join(dbDir, "breeds.json");
  if (existsSync(breedsPath)) {
    console.log("📦 Migrating breeds and tags...");
    const breeds = JSON.parse(readFileSync(breedsPath, "utf8"));
    const insertMany = db.transaction((breedsData) => {
      let nextId = 1;
      breedsData.forEach((breed) => {
        // Normalize tags
        const tags = Array.isArray(breed.tags) ? breed.tags : [];
        const purposeTags = breed.purpose
          ? breed.purpose
              .split("/")
              .map((t) => t.trim())
              .filter(Boolean)
          : [];
        const allTags = [...new Set([...tags, ...purposeTags])];

        // Insert breed with sequential ID
        const breedId = nextId++;
        insertBreed.run({
          id: breedId,
          name: breed.name || "Unknown",
          origin: breed.origin || null,
          subspecies: breed.subspecies || null,
          image_url: breed.imageUrl || null,
          wiki_url: breed.wikiUrl || null,
          props: JSON.stringify({ tags: allTags }),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        // Insert tags and link to breed
        allTags.forEach((tagName) => {
          if (!tagName) return;
          insertTag.run({ name: tagName.toLowerCase() });
          const tagRow = getTagId.get(tagName.toLowerCase());
          if (tagRow) {
            insertBreedTag.run(breedId, tagRow.id); // Use the breed ID we just inserted
          }
        });
      });
    });
    insertMany(breeds);
    console.log(`✅ Migrated ${breeds.length} breeds`);

    // Update JSON file with assigned IDs and convert purpose to tags for dual-write consistency
    const updatedBreeds = breeds
      .map((breed, index) => {
        // Convert purpose to tags if needed (same logic as SQLite migration)
        const tags = Array.isArray(breed.tags) ? breed.tags : [];
        const purposeTags = breed.purpose
          ? breed.purpose
              .split("/")
              .map((t) => t.trim())
              .filter(Boolean)
          : [];
        const allTags = [...new Set([...tags, ...purposeTags])];

        // Create updated breed object
        const updatedBreed = {
          ...breed,
          id: index + 1, // IDs assigned during migration (1-based)
          // Ensure tags field exists (converted from purpose if needed)
          tags: allTags,
        };

        // Remove purpose field since we've converted it to tags
        delete updatedBreed.purpose;

        return updatedBreed;
      })
      .map(
        ({ image_url, wiki_url, created_at, updated_at, purpose, ...rest }) =>
          rest,
      );

    writeFileSync(breedsPath, JSON.stringify(updatedBreeds, null, 2));
    console.log(
      `📝 Updated breeds.json with assigned IDs and converted purpose → tags`,
    );
    console.log("Migrated purpose → tags");
  }

  // 3. Migrate User Herds
  if (existsSync(usersDir)) {
    console.log("📦 Migrating user herds...");
    const userFolders = readdirSync(usersDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    const insertMany = db.transaction((folders) => {
      folders.forEach((folder) => {
        const myherdPath = join(usersDir, folder, "myherd.json");
        if (!existsSync(myherdPath)) return;

        // Decode base64url email
        let email;
        try {
          email = Buffer.from(
            folder.replace(/-/g, "+").replace(/_/g, "/"),
            "base64",
          ).toString("utf8");
        } catch {
          console.warn(`⚠️ Could not decode folder name: ${folder}`);
          return;
        }

        // Find user ID
        const user = db
          .prepare("SELECT id FROM accounts WHERE email = ?")
          .get(email);
        if (!user) {
          console.warn(`⚠️ No account found for ${email}, skipping herd`);
          return;
        }

        const herd = JSON.parse(readFileSync(myherdPath, "utf8"));
        herd.forEach((entry) => {
          insertUserHerd.run({
            user_id: user.id,
            breed_id: entry.id,
            custom_name: entry.name || null,
            custom_image_url: entry.imageUrl || null,
            custom_notes: entry.notes || null,
            created_at: new Date().toISOString(),
          });
        });
      });
    });
    insertMany(userFolders);
    console.log(`✅ Migrated herds for ${userFolders.length} users`);
  }

  console.log("🎉 Migration completed successfully!");
}
