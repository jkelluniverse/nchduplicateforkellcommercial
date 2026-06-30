import http from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { initSocket } from "./lib/socket";
import { ensureMonthRows } from "./routes/rent-status";
import { runCourtReminders } from "./routes/evictions";
import { runDailyReminders } from "./routes/tenant-notes";
import { sendFollowUpReminder } from "./routes/contact-checklist";
import { runFollowupNudgeIfDue } from "./lib/followup-nudge";
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
        kind TEXT DEFAULT 'user',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Backfill columns added after the initial table shape (idempotent).
    await client.query(
      `ALTER TABLE tenant_payment_notes ADD COLUMN IF NOT EXISTS ledger_ack_balance NUMERIC(10,2)`,
    );
    await client.query(
      `ALTER TABLE tenant_note_comments ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'user'`,
    );
    // Monthly communication checklist log (Awaiting Communication). The
    // doorloop_lease_id column carries a Rentec lease id here.
    await client.query(`
      CREATE TABLE IF NOT EXISTS monthly_contact_log (
        id SERIAL PRIMARY KEY,
        property_address TEXT NOT NULL,
        tenant_name TEXT,
        doorloop_lease_id TEXT,
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        status TEXT DEFAULT 'done',
        contacted_at TIMESTAMPTZ DEFAULT NOW(),
        contacted_by TEXT NOT NULL DEFAULT 'jacob',
        contact_method TEXT,
        notes TEXT,
        sms_sent_at TIMESTAMPTZ,
        CONSTRAINT monthly_contact_log_property_month_year_unique
          UNIQUE (property_address, month, year)
      )
    `);
    // Manual rent-status overrides ("Resolved This Month").
    await client.query(`
      CREATE TABLE IF NOT EXISTS rent_status_overrides (
        id SERIAL PRIMARY KEY,
        property_address TEXT NOT NULL,
        doorloop_lease_id TEXT,
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        override_status TEXT NOT NULL,
        reason TEXT NOT NULL,
        notes TEXT,
        created_by TEXT NOT NULL DEFAULT 'jacob',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT rent_status_overrides_property_month_year_unique
          UNIQUE (property_address, month, year)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_log (
        id SERIAL PRIMARY KEY,
        property_address TEXT NOT NULL,
        tenant_name TEXT,
        method TEXT NOT NULL DEFAULT 'other',
        note TEXT,
        contacted_by TEXT NOT NULL DEFAULT 'jacob',
        contacted_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS reminder_log (
        id SERIAL PRIMARY KEY,
        note_id INTEGER,
        property_address TEXT NOT NULL,
        tenant_name TEXT,
        stage TEXT NOT NULL,
        amount NUMERIC(10,2),
        sent_by TEXT NOT NULL DEFAULT 'jacob',
        sent_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    logger.info("Tenant note + collection tables ensured");
  } catch (err) {
    logger.error({ err }, "Failed to create tenant note tables");
  } finally {
    client.release();
  }
}

async function createFollowupTables() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_followup (
        task_id INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
        needs_followup BOOLEAN NOT NULL DEFAULT true,
        snooze_until TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    logger.info("task_followup + app_settings tables ensured");
  } catch (err) {
    logger.error({ err }, "Failed to create follow-up tables");
  } finally {
    client.release();
  }
}

async function createEvictionTables() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS eviction_cases (
        id SERIAL PRIMARY KEY,
        property_address TEXT NOT NULL,
        tenant_name TEXT NOT NULL,
        doorloop_lease_id TEXT,
        doorloop_property_id TEXT,
        balance_at_filing NUMERIC(10,2),
        monthly_rent NUMERIC(10,2),
        balance_written_off NUMERIC(10,2),
        written_off_at TIMESTAMPTZ,
        written_off_notes TEXT,
        status TEXT NOT NULL DEFAULT 'notice_filed',
        notice_filed_date DATE,
        notice_type TEXT,
        court_date DATE,
        court_time TEXT,
        court_location TEXT,
        hearing_outcome TEXT,
        judgment_date DATE,
        judgment_notes TEXT,
        vacated_date DATE,
        created_by TEXT NOT NULL DEFAULT 'jacob',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        closed_at TIMESTAMPTZ,
        notes TEXT
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS eviction_documents (
        id SERIAL PRIMARY KEY,
        eviction_case_id INTEGER REFERENCES eviction_cases(id) ON DELETE CASCADE,
        document_name TEXT NOT NULL,
        document_type TEXT NOT NULL,
        drive_url TEXT,
        drive_file_id TEXT,
        uploaded_at TIMESTAMPTZ DEFAULT NOW(),
        uploaded_by TEXT NOT NULL DEFAULT 'jacob',
        notes TEXT
      )
    `);
    await client.query(`ALTER TABLE eviction_documents ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE eviction_cases ADD COLUMN IF NOT EXISTS notice_expiry_date DATE`);
    await client.query(`ALTER TABLE eviction_cases ADD COLUMN IF NOT EXISTS notice_period_expired BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE eviction_cases ADD COLUMN IF NOT EXISTS attorney_sent_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE eviction_cases ADD COLUMN IF NOT EXISTS attorney_sent_by TEXT`);
    await client.query(`ALTER TABLE eviction_cases ADD COLUMN IF NOT EXISTS contract_drive_url TEXT`);
    await client.query(`ALTER TABLE eviction_cases ADD COLUMN IF NOT EXISTS contract_drive_file_id TEXT`);
    await client.query(`ALTER TABLE eviction_cases ADD COLUMN IF NOT EXISTS contract_found_at TIMESTAMPTZ`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS eviction_timeline (
        id SERIAL PRIMARY KEY,
        eviction_case_id INTEGER REFERENCES eviction_cases(id) ON DELETE CASCADE,
        stage TEXT NOT NULL,
        stage_date TIMESTAMPTZ DEFAULT NOW(),
        notes TEXT,
        created_by TEXT NOT NULL DEFAULT 'jacob'
      )
    `);
    logger.info("eviction tables ensured");
  } catch (err) {
    logger.error({ err }, "Failed to ensure eviction tables");
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

  // Ensure follow-up nudge tables exist (idempotent).
  void createFollowupTables();

  // Ensure eviction tracker tables exist (idempotent).
  void createEvictionTables();

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
    void runCourtReminders();
    setInterval(() => { void runDailyReminders(); void runCourtReminders(); }, 24 * 60 * 60 * 1000);
  }, msUntilNext8AM());

  // Daily 9 AM communication-checklist follow-up reminder. Self-guards (no-ops
  // before the 6th, or when push isn't configured / nothing needs follow-up).
  const msUntilNext9AM = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(9, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  };
  setTimeout(() => {
    void sendFollowUpReminder();
    setInterval(() => { void sendFollowUpReminder(); }, 24 * 60 * 60 * 1000);
  }, msUntilNext9AM());

  // Open-loops daily nudge — minute tick fires once at the configured time.
  setInterval(() => { void runFollowupNudgeIfDue(); }, 60_000);

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
