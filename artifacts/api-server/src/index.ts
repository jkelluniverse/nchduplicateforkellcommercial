import http from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { retryQueuedWrites } from "./lib/sheets-sync";
import { initSocket } from "./lib/socket";
import { scheduleChatCleanup } from "./lib/chat-cleanup";
import { ensureMonthRows } from "./routes/rent-status";
import { runDailyReminders } from "./routes/tenant-notes";
import { syncDirectory } from "./lib/directory-sync";
import { db, usersTable, availablePropertiesTable, pool } from "@workspace/db";
import { eq } from "drizzle-orm";

async function ensureFormSchemaColumns() {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE tenant_applications
        ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new'
    `);
    logger.info("tenant_applications.status column ensured");
  } catch (err) {
    logger.error({ err }, "Failed to ensure tenant_applications.status column");
  } finally {
    client.release();
  }
}

async function createTenantNoteTables() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenant_payment_notes (
        id SERIAL PRIMARY KEY,
        property_address TEXT NOT NULL,
        tenant_name TEXT NOT NULL,
        doorloop_lease_id TEXT,
        situation TEXT NOT NULL,
        expected_payment_date DATE,
        expected_payment_amount NUMERIC(10,2),
        status TEXT NOT NULL DEFAULT 'open',
        created_by TEXT NOT NULL DEFAULT 'jacob',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        resolved_at TIMESTAMPTZ
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenant_note_comments (
        id SERIAL PRIMARY KEY,
        note_id INTEGER REFERENCES tenant_payment_notes(id) ON DELETE CASCADE,
        author TEXT NOT NULL,
        comment TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    logger.info("Tenant note tables ensured");
  } catch (err) {
    logger.error({ err }, "Failed to create tenant note tables");
  } finally {
    client.release();
  }
}

async function seedUsers() {
  // Single operator login for Kell Commercial. Credentials come from the
  // environment so no personal password ever lives in source/git history.
  const users = [
    {
      name: "Kell Commercial",
      username: process.env["ADMIN_USERNAME"] || "admin",
      password: process.env["ADMIN_PASSWORD"] || "changeme",
      // "jacob" is the app's internal full-administrator role identifier.
      role: "jacob" as const,
      email: process.env["ADMIN_EMAIL"] || "admin@kellcommercial.com",
      phone: "",
    },
  ];
  for (const u of users) {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.username, u.username));
    if (!existing) {
      await db.insert(usersTable).values(u);
      logger.info({ username: u.username }, "Seeded user");
    } else if (existing.password !== u.password) {
      // Keep stored credentials in sync with the canonical seed.
      await db.update(usersTable).set({ password: u.password }).where(eq(usersTable.username, u.username));
      logger.info({ username: u.username }, "Updated user password to match seed");
    }
  }
}

async function migratePropertiesTable() {
  const client = await pool.connect();
  try {
    // Check if old schema exists (has 'group' column)
    const check = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'properties' AND column_name = 'group_name'
      UNION
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'properties' AND column_name = 'group'
    `);
    const hasOldSchema = check.rows.length > 0;

    if (hasOldSchema) {
      logger.info("Migrating properties table to new schema...");
      // Save notes from existing rows
      const notesBackup = await client.query(`
        SELECT doorloop_id, notes FROM properties WHERE notes IS NOT NULL AND notes != ''
      `);

      // Drop FK constraints from rent_status pointing to properties
      await client.query(`DELETE FROM rent_status`);

      // Drop old table and recreate with new schema
      await client.query(`DROP TABLE IF EXISTS properties CASCADE`);
      await client.query(`
        CREATE TABLE properties (
          id SERIAL PRIMARY KEY,
          doorloop_property_id TEXT UNIQUE,
          doorloop_lease_id TEXT,
          address TEXT NOT NULL,
          resident1_name TEXT,
          resident1_phone TEXT,
          resident1_email TEXT,
          resident2_name TEXT,
          resident2_phone TEXT,
          resident2_email TEXT,
          notes TEXT,
          last_synced_at TIMESTAMPTZ
        )
      `);
      logger.info({ notesBackupCount: notesBackup.rows.length }, "Properties table migrated to new schema");
    } else {
      // Check if table exists at all
      const tableCheck = await client.query(`
        SELECT 1 FROM information_schema.tables WHERE table_name = 'properties'
      `);
      if (tableCheck.rows.length === 0) {
        await client.query(`
          CREATE TABLE properties (
            id SERIAL PRIMARY KEY,
            doorloop_property_id TEXT UNIQUE,
            doorloop_lease_id TEXT,
            address TEXT NOT NULL,
            resident1_name TEXT,
            resident1_phone TEXT,
            resident1_email TEXT,
            resident2_name TEXT,
            resident2_phone TEXT,
            resident2_email TEXT,
            notes TEXT,
            last_synced_at TIMESTAMPTZ
          )
        `);
        logger.info("Created properties table with new schema");
      }
    }

    // Also drop the old tenant_directory table if it exists
    await client.query(`DROP TABLE IF EXISTS tenant_directory`);
  } finally {
    client.release();
  }
}

async function seedAvailableProperties() {
  // Only seed when the table is completely empty so we never resurrect rows
  // that Mike or Jacob deactivated through the UI.
  const existing = await db.select({ id: availablePropertiesTable.id }).from(availablePropertiesTable).limit(1);
  if (existing.length > 0) return;

  const seed = [
    { number: "01", address: "1200 Maryland Ave SW",  cityStateZip: "Canton, OH 44710", beds: 2, baths: 1, sortOrder: 1 },
    { number: "02", address: "534 Columbus Ave SW",   cityStateZip: "Canton, OH 44702", beds: 3, baths: 1, sortOrder: 2 },
    { number: "03", address: "2508 17th St SW",       cityStateZip: "Canton, OH 44706", beds: 2, baths: 1, sortOrder: 3 },
    { number: "04", address: "1259 Harrison Ave SW",  cityStateZip: "Canton, OH 44706", beds: 3, baths: 1, sortOrder: 4 },
    { number: "05", address: "2015 Bryan Ave SW",     cityStateZip: "Canton, OH 44706", beds: 3, baths: 1, sortOrder: 5 },
    { number: "06", address: "2015 11th St SW",       cityStateZip: "Canton, OH 44706", beds: 3, baths: 1, sortOrder: 6 },
    { number: "07", address: "1215 14th St NW",       cityStateZip: "Canton, OH 44703", beds: 3, baths: 1, sortOrder: 7 },
    { number: "08", address: "521 Elgin Ave NW",      cityStateZip: "Canton, OH 44703", beds: 3, baths: 1, sortOrder: 8 },
    { number: "09", address: "1663 Alden Ave SW",     cityStateZip: "Canton, OH 44706", beds: 2, baths: 1, sortOrder: 9 },
    { number: "10", address: "1825 Roosevelt Ave NE", cityStateZip: "Canton, OH 44705", beds: 3, baths: 1, sortOrder: 10 },
    { number: "11", address: "908 Gilmor Ave NW",     cityStateZip: "Canton, OH 44703", beds: 3, baths: 2, sortOrder: 11 },
    { number: "12", address: "1037 Cherry Ave NE",    cityStateZip: "Canton, OH 44704", beds: 3, baths: 1, sortOrder: 12 },
  ];
  await db.insert(availablePropertiesTable).values(seed);
  logger.info({ count: seed.length }, "Seeded initial available properties");
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);
initSocket(server);

server.listen(port, () => {
  logger.info({ port }, "Server listening (with Socket.io)");

  // Env-var audit: report which integration-critical vars are present/missing
  // so Railway log readers can immediately see config gaps.
  const envVars = [
    "MASTER_SHEET_2_ID",
    "SHEET_5_ID",
    "NICE_CITY_HOMES_FOLDER_ID",
    "GOOGLE_DRIVE_FOLDER_ID",
    "GOOGLE_CLIENT_EMAIL",
    "GOOGLE_PRIVATE_KEY",
  ] as const;
  const envStatus: Record<string, string> = {};
  for (const v of envVars) envStatus[v] = process.env[v] ? "set" : "MISSING";
  logger.info({ envStatus }, "Integration env-var audit");

  // Ensure tenant note tables exist on Railway (idempotent)
  void createTenantNoteTables();

  // Ensure forms schema columns (idempotent — ADD COLUMN IF NOT EXISTS)
  void ensureFormSchemaColumns();

  // Migrate properties table schema (idempotent — only runs once)
  void (async () => {
    try {
      await migratePropertiesTable();
    } catch (err) {
      logger.error({ err }, "Properties table migration failed");
    }
    // Seed required users after migration
    await seedUsers();
  })();

  // Seed initial Available Properties list (idempotent — only when table is empty)
  void seedAvailableProperties();

  // Retry any queued sheet writes on startup
  void retryQueuedWrites();

  // Retry every 15 minutes
  setInterval(() => { void retryQueuedWrites(); }, 15 * 60 * 1000);

  // Schedule daily soft-delete of messages older than 30 days
  scheduleChatCleanup();

  // Ensure rent_status rows exist for the current month on startup.
  // The /api/rent-status/summary endpoint also runs this on every call,
  // so the data is always current without depending on a scheduled job.
  void (async () => {
    const now = new Date();
    try {
      await ensureMonthRows(now.getMonth() + 1, now.getFullYear());
    } catch (err) {
      logger.error({ err }, "Failed to ensure rent_status current month rows");
    }
  })();

  // Re-check every 6 hours so a fresh month rolls in even if no user opens
  // the dashboard right at midnight on the 1st.
  setInterval(() => {
    void (async () => {
      const now = new Date();
      try {
        await ensureMonthRows(now.getMonth() + 1, now.getFullYear());
      } catch (err) {
        logger.error({ err }, "Failed periodic ensureMonthRows");
      }
    })();
  }, 6 * 60 * 60 * 1000);

  // Schedule daily 8 AM payment follow-up reminders for tenant notes
  const msUntilNext8AM = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(8, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  };
  setTimeout(() => {
    void runDailyReminders();
    setInterval(() => { void runDailyReminders(); }, 24 * 60 * 60 * 1000);
  }, msUntilNext8AM());

  // Directory sync from DoorLoop on startup
  void (async () => {
    try {
      await syncDirectory();
    } catch (err) {
      logger.error({ err }, "Initial DoorLoop directory sync failed");
    }
  })();
  // Re-sync every 30 minutes
  setInterval(() => {
    void (async () => {
      try {
        await syncDirectory();
      } catch (err) {
        logger.error({ err }, "Periodic DoorLoop directory sync failed");
      }
    })();
  }, 30 * 60 * 1000);
});


server.on("error", (err) => {
  logger.error({ err }, "HTTP server error");
  process.exit(1);
});
