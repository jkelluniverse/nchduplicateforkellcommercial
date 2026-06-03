---
name: Rent delinquency — trust DoorLoop balances
description: getRentStatus must derive delinquency from DoorLoop lease balances, not from reconstructing dues from payment history
---

# Rent delinquency is driven by DoorLoop balances, not payment history

In `getRentStatus` (artifacts/api-server/src/services/doorloop.ts), the
authoritative signals for what a tenant owes are the DoorLoop lease fields
`outstandingBalance` (net of credits/prepayments) and `overdueBalance` (the
past-due portion). Classify from these, NOT by re-summing payments per month.

**Why:** A single DoorLoop payment can be auto-applied to arbitrary back-charges.
A real case: a tenant made one large payment that DoorLoop applied to old
arrears; a payment-history "did they pay last month's rent?" reconstruction
counted it as the current cycle covered and wrongly cleared a tenant who was
actually ~3 months / several thousand dollars overdue. Payment-history
carry-forward also broke on partial payments and on credit/prepaid leases
(e.g. `outstanding=0, overdue>0, currentBalance<0`).

**How to apply (current-month, no/partial payment):**
- `owesNothing = outstandingBalance <= 0` → current; never delinquent. This is
  what nets out a credit that offsets an overdue balance.
- A lease whose `start` is in the viewed month or later did not exist then →
  never delinquent for that period. Parse `start` by `^(\d{4})-(\d{2})` (string
  compare, not `new Date`) to avoid timezone drift. This guard applies to
  BOTH current and historical months.
- When `overdueBalance > 0`, estimate months behind as
  `Math.max(1, Math.round(overdue / monthlyRent))` and age from the oldest
  unpaid month: `missedSince = new Date(year, month-1-(monthsOverdue-1), 1)`.
  `delinquent` at `daysOverdue >= 30`, else `unpaid` (or `partial` if a partial
  payment landed this month). Use `round`, NOT `floor` — a tenant ~1.5 months
  behind (overdue ≈ 1.5× rent) must round up to 2 → ~32 days → delinquent;
  `floor` would collapse them to the current cycle and falsely clear them.

**Branch ordering that satisfies the above:** started-this-month-or-later →
full-payment(paid/late, 10-day grace) → historical(partial else delinquent/30)
→ owesNothing → overdue>0(aged) → owes-current-only(unpaid/partial).

**Known limitation (intentional):** a tenant who pays the current month in full
but still carries older arrears is reported `paid` for the month (month-centric
view). There was no such tenant in the portfolio when this was written; revisit
if "current month paid but has back balance" needs to surface in Needs Attention.

**Notice escalation:** `detail-sheet.tsx handleSendNotice` pre-selects
`notice_of_default` at `daysOverdue >= 30`, else `ten_day_notice`. The
"Needs Attention" widget filters `status === "delinquent" && daysOverdue >= 30`.
Keep these aligned with the 30-day `DELINQUENT_DAYS` threshold.
