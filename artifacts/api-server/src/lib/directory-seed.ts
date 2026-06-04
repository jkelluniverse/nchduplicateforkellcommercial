/**
 * Directory seed — Kell Commercial tenant contacts.
 *
 * Source: Jacob's "TenantCloud_Property" contact sheet (names, phones, emails,
 * mailing addresses). The live Rentec directory sync only fills the directory
 * when the Rentec API returns data; until then (and as a stable fallback) we
 * seed the curated contact list below so Properties + Directory are populated.
 *
 * This seed is NON-DESTRUCTIVE: it matches existing rows by street address and
 * only fills blank fields, otherwise inserts a new row keyed `seed:<street>`.
 * The Rentec sync is set up to never delete these `seed:` rows.
 */
import { db, propertiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export interface SeedContact {
  street: string; // canonical street line, used for matching
  city: string;
  state: string;
  zip: string;
  r1Name: string;
  r1Phone?: string;
  r1Email?: string;
  r2Name?: string;
  r2Phone?: string;
  r2Email?: string;
  notes?: string;
}

export const DIRECTORY_CONTACTS: SeedContact[] = [
  { street: "1620 Wooster Ave NE", city: "Canton", state: "OH", zip: "44705", r1Name: "Javier Cruz Coraliza", r1Phone: "234-706-4492", r2Name: "Erika Olivio", r2Phone: "716-753-6160", r2Email: "Erikasierraolivo04@gmail.com" },
  { street: "1034 Prospect Ave SW", city: "Canton", state: "OH", zip: "44706", r1Name: "Rolando Barrios", r1Phone: "234-360-7063", r1Email: "barriosrolando796@gmail.com", notes: "Pays on the 23rd" },
  { street: "1609 Oxford Ave NW", city: "Canton", state: "OH", zip: "44703", r1Name: "Joan Mejia Perez", r1Phone: "330-934-9325", r1Email: "mp5174665@gmail.com" },
  { street: "1026 Arlington Ave SW", city: "Canton", state: "OH", zip: "44706", r1Name: "Tello Salas Carmen Lizbeth", r1Phone: "352-949-9333", r1Email: "carmentello95@gmail.com" },
  { street: "2531 7th St NE", city: "Canton", state: "OH", zip: "44704", r1Name: "Floridalia Estrada Rodas", r1Phone: "330-774-2407", r1Email: "Floridaliaestrada427@gmail.com", r2Name: "Antonio Rodas", r2Email: "joseantonioae9004399@gmail.com" },
  { street: "1716 3rd St NE", city: "Canton", state: "OH", zip: "44704", r1Name: "Mary Ramirez", r1Phone: "330-437-5626", r1Email: "marygonzalez498@gmail.com" },
  { street: "812 5th St NE", city: "Canton", state: "OH", zip: "44704", r1Name: "Justin Zurfley", r1Phone: "330-809-3346", r1Email: "jdzmnez2010@gmail.com" },
  { street: "2227 40th St NW", city: "Canton", state: "OH", zip: "44709", r1Name: "Cherita White", r1Phone: "234-322-3723", r1Email: "cheritawhite701@gmail.com" },
  { street: "1615 38th St NW", city: "Canton", state: "OH", zip: "44709", r1Name: "Charles Anderson", r1Phone: "330-327-5398", r1Email: "charles.aandersonjr@yahoo.com" },
  { street: "3008 Willowrow Ave NE", city: "Canton", state: "OH", zip: "44705", r1Name: "Fanny Sauceda", r1Phone: "330-706-5397", r1Email: "cesarmartinez0805@gmail.com", notes: "Pays on the 20th · Alt phone 330-412-8574" },
  { street: "2010 9th St SW", city: "Canton", state: "OH", zip: "44706", r1Name: "Joas Rosier", r1Phone: "330-737-8552", r1Email: "rosierjoas18@gmail.com" },
  { street: "1016 Arlington Ave SW", city: "Canton", state: "OH", zip: "44706", r1Name: "Tello Salas Carmen Lizbeth", r1Phone: "352-949-9333", r1Email: "carmentello95@gmail.com" },
  { street: "1532 Olive Pl NE", city: "Canton", state: "OH", zip: "44705", r1Name: "Roxanne Bennett", r1Phone: "330-479-6750", r1Email: "roxannebennett60@gmail.com", notes: "Alt phone 330-704-4168" },
  { street: "1640 31st St NE", city: "Canton", state: "OH", zip: "44714", r1Name: "Ariana Mcpeters", r1Phone: "234-410-4457", r1Email: "arianamcpeters@gmail.com" },
  { street: "1820 Vine Ave SW", city: "Canton", state: "OH", zip: "44706", r1Name: "Kevin Leech", r1Phone: "330-495-9087", r1Email: "kev.leech9966@gmail.com" },
  { street: "1618 19th St NE", city: "Canton", state: "OH", zip: "44714", r1Name: "Tom Reed", r1Phone: "330-209-1824", r1Email: "tomreed859@gmail.com", notes: "Pays on the 15th" },
  { street: "1202 15th St NE", city: "Canton", state: "OH", zip: "44705", r1Name: "Robert" },
  { street: "2617 Avalon Ave NE", city: "Canton", state: "OH", zip: "44705", r1Name: "Mary Miku", r1Phone: "234-458-4101", r2Name: "Patrick Miku", r2Phone: "234-207-7384", r2Email: "patrickmiku28@gmail.com" },
  { street: "1200 14th St NE", city: "Canton", state: "OH", zip: "44705", r1Name: "Thomas Kellicker", r1Phone: "330-952-7410", r1Email: "tomk_32@icloud.com" },
  { street: "1461 John Ct SE", city: "Canton", state: "OH", zip: "44707", r1Name: "Fred Wilkinson" },
  { street: "219 14th St NW", city: "Canton", state: "OH", zip: "44703", r1Name: "Frosty Ann Saunier", r1Phone: "330-324-8278", r1Email: "frosty.saunier75@gmail.com" },
  { street: "1535 Vine Ave SW", city: "Canton", state: "OH", zip: "44706", r1Name: "Anthony Sindledecker", r1Phone: "330-371-8461", r1Email: "anthonysindledecker1@gmail.com", r2Name: "Alyssa Marie Wainwright", r2Email: "alyssa.wainwright2015@gmail.com" },
  { street: "1304 Cole Ave SE", city: "Canton", state: "OH", zip: "44707", r1Name: "Dan Radtka", r1Phone: "234-425-2056", r1Email: "radtkadan453@gmail.com", notes: "Unit recently vacated" },
  { street: "1314 Plain Ave NE", city: "Canton", state: "OH", zip: "44714", r1Name: "Terry Williams", r1Phone: "330-445-0949", r1Email: "steeldog1110@yahoo.com" },
  { street: "1815 3rd St SE", city: "Canton", state: "OH", zip: "44704", r1Name: "Joy Resendiz", r1Phone: "234-322-3345", r1Email: "hooverjoy961@gmail.com" },
];

export function normStreet(addr: string | null | undefined): string {
  if (!addr) return "";
  return (addr.split(",")[0] ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

interface SeedResult {
  inserted: number;
  updated: number;
}

/**
 * Upsert the curated contacts into the properties table. Matches existing rows
 * by street (so it never duplicates a Rentec-synced row) and only fills blank
 * contact fields; inserts a `seed:<street>` row when no match exists.
 */
export async function seedDirectoryFromContacts(): Promise<SeedResult> {
  const existing = await db.select().from(propertiesTable);
  const byStreet = new Map(existing.map((p) => [normStreet(p.address), p]));

  let inserted = 0;
  let updated = 0;
  const now = new Date();

  for (const c of DIRECTORY_CONTACTS) {
    const street = normStreet(c.street);
    const full = `${c.street}, ${c.city}, ${c.state} ${c.zip}`;
    const match =
      byStreet.get(street) ??
      existing.find((p) => {
        const s = normStreet(p.address);
        return s !== "" && (s.includes(street) || street.includes(s));
      });

    if (match) {
      // Fill only blank fields so we never clobber edited/Rentec data.
      const patch: Record<string, unknown> = {};
      if (!match.resident1Name && c.r1Name) patch["resident1Name"] = c.r1Name;
      if (!match.resident1Phone && c.r1Phone) patch["resident1Phone"] = c.r1Phone;
      if (!match.resident1Email && c.r1Email) patch["resident1Email"] = c.r1Email;
      if (!match.resident2Name && c.r2Name) patch["resident2Name"] = c.r2Name;
      if (!match.resident2Phone && c.r2Phone) patch["resident2Phone"] = c.r2Phone;
      if (!match.resident2Email && c.r2Email) patch["resident2Email"] = c.r2Email;
      if (!match.notes && c.notes) patch["notes"] = c.notes;
      if (Object.keys(patch).length > 0) {
        await db.update(propertiesTable).set(patch).where(eq(propertiesTable.id, match.id));
        updated++;
      }
    } else {
      await db.insert(propertiesTable).values({
        doorloopPropertyId: `seed:${street}`,
        address: full,
        resident1Name: c.r1Name,
        resident1Phone: c.r1Phone ?? null,
        resident1Email: c.r1Email ?? null,
        resident2Name: c.r2Name ?? null,
        resident2Phone: c.r2Phone ?? null,
        resident2Email: c.r2Email ?? null,
        notes: c.notes ?? null,
        lastSyncedAt: now,
      });
      inserted++;
    }
  }

  logger.info({ inserted, updated, total: DIRECTORY_CONTACTS.length }, "Directory contacts seed complete");
  return { inserted, updated };
}
