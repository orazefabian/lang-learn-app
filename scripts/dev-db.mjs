import { mkdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

/**
 * A throwaway Postgres for local development on a machine without Docker.
 * Speaks the real wire protocol, so the app connects to it exactly as it
 * would to the compose database. Not for production — use Postgres there.
 */
const port = Number(process.env.DEV_DB_PORT ?? 5432);
const dataDir = process.env.DEV_DB_DIR ?? "./.devdb";

await mkdir(dataDir, { recursive: true });
const db = await PGlite.create({ dataDir });
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
await server.start();

console.log(`dev database listening on postgres://postgres:postgres@127.0.0.1:${port}/postgres`);
console.log(`data directory: ${dataDir}`);

const shutdown = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
