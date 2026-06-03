# Kell Commercial Leasing

A lightweight payment-tracking companion app for the **Kell Commercial** family
portfolio (Dad's portfolio, including the newly acquired Kell Building). It syncs
**read-only** from Rentec Direct and surfaces, at a glance, who is current vs.
past due and by how much — plus a personal task list and a tenant/contact
directory.

> This app is for **Kell Commercial only**. It uses its **own separate database**
> and its **own read-only Rentec Direct connection**. It must never connect to,
> read from, or share Nice City Homes' database, DoorLoop, or Google account.

## What it does

- **Live payment tracking** synced from Rentec Direct — per-property and
  per-tenant account status, current balance, and past-due amount.
- **Dashboard** where "current vs. past due, and by how much" is obvious at a
  glance, with a manual **Refresh** button and a background sync.
- **Tenant records** with the payment situation front and center.
- **Property + unit records** (the Kell Building = one property, many units).
- **Personal task list** (create / edit / complete).
- **Contact directory** (names, phones, emails).

## Tech

- pnpm monorepo. Backend: Express + Drizzle ORM (Postgres), bundled with esbuild.
  Frontend: React + Vite + Tailwind. Realtime via Socket.io. Web-push for alerts.
- Read-only Rentec Direct v3 client: `artifacts/api-server/src/services/rentec.ts`.
  See [`RENTEC_SYNC_SPEC.md`](./RENTEC_SYNC_SPEC.md).

## Local development

```bash
cp .env.example .env        # then fill in DATABASE_URL, RENTEC_API_KEY, SESSION_SECRET
pnpm install
pnpm --filter @workspace/db run push        # create tables in your own empty DB
pnpm --filter @workspace/api-server run dev  # builds + starts the API on PORT
pnpm --filter @workspace/nch-ops run dev     # Vite dev server for the SPA
```

Build everything (what the deploy does):

```bash
pnpm --filter @workspace/nch-ops run build      # -> artifacts/nch-ops/dist/public
pnpm --filter @workspace/api-server run build    # -> artifacts/api-server/dist/index.mjs
```

In production a single Node process serves both the API and the built SPA.

## Required secrets (set in Railway / your host, never commit)

See `.env.example`. At minimum:

| Variable          | Purpose                                                   |
|-------------------|-----------------------------------------------------------|
| `DATABASE_URL`    | Postgres for THIS app's own separate database (not NCH's). |
| `RENTEC_API_KEY`  | **Read-only** Rentec Direct key for the Kell portfolio.   |
| `SESSION_SECRET`  | Signs login/JWT tokens.                                    |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_EMAIL` | Operator login (seeded on boot). |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web push (optional). |
| `APP_URL`         | Public URL used in reminder emails/notifications (optional). |
| `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` | Gmail-API reminder emails (optional). |

## Read-only guarantee

The Rentec client only issues `GET` requests and never POSTs/PUTs/writes back to
Rentec. The app reads balances that Rentec computes (`Lease.balance`,
`Tenant.balance`) rather than deriving what's owed from transactions.
