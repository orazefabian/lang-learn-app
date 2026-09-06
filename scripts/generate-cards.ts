import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { createCardsForActiveContent } from "@/lib/srs/cards";

/**
 * Creates cards for all active content that has none yet.
 *
 * Normally cards appear when a lesson is completed. This is the manual path,
 * useful right after seeding and whenever content is activated in bulk.
 *
 *   pnpm cards:generate                 # for every account
 *   pnpm cards:generate user@example    # for one account
 */
const emailFilter = process.argv[2];

const accounts = emailFilter
  ? await db.select().from(users).where(eq(users.email, emailFilter.toLowerCase()))
  : await db.select().from(users);

if (!accounts.length) {
  console.error("no matching accounts");
  process.exit(1);
}

for (const account of accounts) {
  const result = await createCardsForActiveContent(db, account.id, 5000);
  console.log(
    `${account.email}: created ${result.created} cards, ${result.skipped} already existed`,
  );
}

process.exit(0);
