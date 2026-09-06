import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

type Sql = ReturnType<typeof postgres>;
type Database = PostgresJsDatabase<typeof schema>;

declare global {
  // Reused across hot reloads in development so we do not leak connections.
  // eslint-disable-next-line no-var
  var __sloveneSql: Sql | undefined;
}

let sqlInstance: Sql | null = null;
let dbInstance: Database | null = null;

/**
 * The connection is created on first use, not at import time, so a build (or a
 * unit test) that never touches the database needs no DATABASE_URL.
 */
export function getSql(): Sql {
  if (sqlInstance) return sqlInstance;
  sqlInstance =
    globalThis.__sloveneSql ??
    postgres(env().DATABASE_URL, {
      max: env().NODE_ENV === "production" ? 10 : 5,
      idle_timeout: 30,
      prepare: false,
    });
  if (env().NODE_ENV !== "production") globalThis.__sloveneSql = sqlInstance;
  return sqlInstance;
}

export function getDb(): Database {
  dbInstance ??= drizzle(getSql(), { schema, casing: "snake_case" });
  return dbInstance;
}

/** Proxy so call sites read as `db.select(...)` while staying lazy. */
export const db: Database = new Proxy({} as Database, {
  get(_target, property, receiver) {
    return Reflect.get(getDb(), property, receiver);
  },
});

export { schema };
export type Db = Database;
