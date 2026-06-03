# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## DoorLoop Integration (live)

NCH Operations is wired to the live DoorLoop API for the Nice City Homes
Canton OH portfolio (33 properties, 34 leases, 50 tenants).

- Toggle: `USE_DOORLOOP=true` (set in `.replit` userenv.shared) and
  `DOORLOOP_API_TOKEN` (Replit secret).
- Client: `artifacts/api-server/src/services/doorloop.ts` — 5-min cache,
  paginated, returns null on failure so callers can fall back to local data.
- Endpoints: `/api/doorloop/{status,sync,properties,payments,late-fees,
  rent-status}`.
- Rent-status pathway: `/api/rent-status/summary` and `/detail` use the live
  DoorLoop snapshot when `USE_DOORLOOP=true`, falling back to the local
  `rent_status` table on any DoorLoop error.
- Rent grace period: 10 days. Payments on or before the 10th of the month
  count as "paid"; only payments after the 10th are marked "late".
- Property mirror: at startup (and every 30 min) `seedDoorLoopProperties()`
  upserts every DoorLoop property into the local `properties` table by
  `doorloop_id` (the column added in this iteration). This is what makes
  the rent-status detail sheet (`/api/rent-status/:propertyId`) open
  cleanly for all 33 properties — previously detail rows had `propertyId=-1`
  for every DoorLoop row because only 8 sample addresses existed locally.
- Tenant sync: `syncDoorLoopTenants()` runs after the property seed and
  fills in tenant names by matching `prospectInfo.interests` →
  `(property,unit)`. Never wipes a non-empty value.

## Forms (Public + In-App)

Two public-facing forms are accessible without login:
- `/apply` — Tenant Application → writes to Google Sheet `1a19ciFDc_wp9QIpDMqI0_XYd-zjXuMM4w9C8UqF1Zw8`
- `/utilities` — Utility Accounts → writes to Google Sheet `1_TFYppOupx96gsUR-vdmRBknwuFRu9VKuzXOvBPypwY`

Backend routes (no auth required for POST, Jacob-only for GET submissions):
- `POST /api/public/tenant-application` — multipart, writes to `tenant_applications` table + Drive upload + Sheet append + email to Jacob
- `POST /api/public/utility-submission` — JSON, writes to `utility_submissions` table + Sheet append + email to Jacob
- `GET /api/forms/tenant-applications` — Jacob-only, reads from DB
- `GET /api/forms/utility-submissions` — Jacob-only, reads from DB

The tenant application form uses ONE email field (`loginEmail`); the frontend
copies that value into `contactEmail` before submitting so the existing DB
column stays populated.

In-app: More → Forms shows cards with Open Form (embedded iframe), Send Link
(clipboard/share sheet), and View Submissions (Jacob only).

## Push Notifications (Web Push / PWA)

iPhone push notifications are delivered via Web Push. iOS requires the app
to be installed to the Home Screen as a PWA (Safari tab push is not supported
by Apple).

Required env vars (Replit Secrets + Railway):
- `VAPID_PUBLIC_KEY` — VAPID public key (already set in .replit userenv.shared)
- `VAPID_PRIVATE_KEY` — VAPID private key (Replit Secret)
- `VAPID_SUBJECT` — contact URI, e.g. `mailto:jacob@nicecityhomes.com` (set in .replit)

To regenerate keys (only if rotating): `npx web-push generate-vapid-keys`
then update both Replit Secrets and Railway env vars.

Flow: AuthProvider calls `subscribeIfGranted()` on login (no OS prompt).
First-run iOS PWA banner (`NotificationBanner`) explains push and calls
`setupPushNotifications()` on explicit tap → then requests OS permission.

## Deployment (Railway)

The production app is deployed on Railway (custom domain
`app.nicecityhomes.com`). Railway watches the `subrepl-031tgwo4` remote
(`github.com/jkelluniverse/Asset-Manager`, branch `main`) and rebuilds on
each push. The Replit Agent cannot push to GitHub directly — to ship,
open the Git pane in the Replit workspace and push `main`, or run
`git push subrepl-031tgwo4 main` from a Replit shell.
