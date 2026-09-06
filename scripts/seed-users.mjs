import { randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";
import postgres from "postgres";

/**
 * Creates (or updates) the only two accounts this app will ever have.
 * Deliberately written against raw SQL so it also runs inside the production
 * image, where the TypeScript sources are not present.
 *
 * Passwords come from the environment; a missing one is generated and printed
 * exactly once.
 */
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

/**
 * An empty variable means unset, not "an empty value".
 *
 * .env.example lists every key with a blank value, so copying it verbatim used
 * to hand both accounts a password of "" — `??` only guards against undefined.
 */
const set = (value) => (value?.trim() ? value : undefined);

/**
 * The login form validates the address before it looks anything up, so an
 * account seeded with an address that form rejects can never be used. Checked
 * here with the same rule rather than discovered at the login screen, where
 * the failure looks like a wrong password.
 *
 * The practical trap is a single-label domain: `fabian@local` is a perfectly
 * good local mailbox and is not a valid email address.
 */
const LOGIN_EMAIL = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;

const specs = [
  {
    role: "learner",
    email: set(process.env.LEARNER_EMAIL),
    password: set(process.env.LEARNER_PASSWORD),
    displayName: set(process.env.LEARNER_NAME) ?? "Lernende",
  },
  {
    role: "teacher",
    email: set(process.env.TEACHER_EMAIL),
    password: set(process.env.TEACHER_PASSWORD),
    displayName: set(process.env.TEACHER_NAME) ?? "Lehrer",
  },
];

const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  for (const spec of specs) {
    if (!spec.email) {
      console.warn(`skipping ${spec.role}: set ${spec.role.toUpperCase()}_EMAIL to seed it`);
      continue;
    }

    const email = spec.email.trim().toLowerCase();

    if (!LOGIN_EMAIL.test(email)) {
      console.error(
        `refusing to seed ${spec.role}: "${email}" is not an address the login form accepts.\n` +
          `  It needs a dotted domain — "${email}.test" or a real address.\n` +
          `  Seeding it would create an account that cannot sign in.`,
      );
      process.exitCode = 1;
      continue;
    }
    const password = spec.password ?? randomBytes(12).toString("base64url");
    const passwordHash = await hash(password, ARGON2_OPTIONS);

    const [user] = await sql`
      insert into users (email, display_name, role, password_hash)
      values (${email}, ${spec.displayName}, ${spec.role}, ${passwordHash})
      on conflict (email) do update
        set password_hash = excluded.password_hash,
            display_name  = excluded.display_name,
            role          = excluded.role,
            updated_at    = now()
      returning id, (xmax = 0) as created
    `;

    await sql`
      insert into user_settings (user_id) values (${user.id})
      on conflict (user_id) do nothing
    `;

    console.log(`${user.created ? "created" : "updated"} ${spec.role}: ${email}`);
    if (!spec.password) console.log(`  generated password: ${password}`);
  }
} catch (error) {
  console.error("seeding users failed:", error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
