import http from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { initSocket } from "./lib/socket";
import { ensureMonthRows } from "./routes/rent-status";
import { runDailyReminders } from "./routes/tenant-notes";
import { syncDirectory } from "./lib/directory-sync";
import { seedDirectoryFromContacts } from "./lib/directory-seed";
import { db, usersTable, pool } from "@workspace/db";
import { eq } from "drizzle-orm";

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
        created_by TEXT NOT NULL DEFAULT 'admin',
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
      await db.update(usersTable).set({ password: u.password }).where(eq(usersTable.username, u.username));
      logger.info({ username: u.username }, "Updated user password to match seed");
    }
  }
}

async function migratePropertiesTable() {
  const client = await pool.connect();
  try {
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
      logger.info("Created properties table");
    }
  } finally {
    client.release();
  }
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

  // Env-var audit: surface integration config gaps in the Railway logs.
  const envVars = ["DATABASE_URL", "RENTEC_API_KEY", "SESSION_SECRET"] as const;
  const envStatus: Record<string, string> = {};
  for (const v of envVars) envStatus[v] = process.env[v] ? "set" : "MISSING";
  logger.info({ envStatus }, "Integration env-var audit");

  // Ensure tenant note tables exist (idempotent).
  void createTenantNoteTables();

  // Create the properties table + seed the operator login (idempotent).
  void (async () => {
    try {
      await migratePropertiesTable();
    } catch (err) {
      logger.error({ err }, "Properties table migration failed");
    }
    await seedUsers();
  })();

  // Ensure rent_status rows exist for the current month on startup.
  void (async () => {
    const now = new Date();
    try {
      await ensureMonthRows(now.getMonth() + 1, now.getFullYear());
    } catch (err) {
      logger.error({ err }, "Failed to ensure rent_status current month rows");
    }
  })();

  // Re-check every 6 hours so a fresh month rolls in.
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

  // Daily 8 AM payment follow-up reminders for tenant notes.
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

  // Populate the directory from the curated contact seed (idempotent,
  // non-destructive), then run the Rentec directory sync on startup and every
  // 30 minutes.
  void (async () => {
    try {
      await seedDirectoryFromContacts();
    } catch (err) {
      logger.error({ err }, "Directory contacts seed failed");
    }
    try {
      await syncDirectory();
    } catch (err) {
      logger.error({ err }, "Initial Rentec directory sync failed");
    }
  })();
  setInterval(() => {
    void (async () => {
      try {
        await syncDirectory();
      } catch (err) {
        logger.error({ err }, "Periodic Rentec directory sync failed");
      }
    })();
  }, 30 * 60 * 1000);
});

server.on("error", (err) => {
  logger.error({ err }, "HTTP server error");
  process.exit(1);
});
