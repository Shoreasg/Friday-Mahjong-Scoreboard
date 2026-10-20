import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { pool } from "@workspace/db";

export async function reconcileReservations() {
  const sql = await readFile(new URL("../../lib/db/src/reservation-schema.sql", import.meta.url), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(684103921)");
    await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reconcileReservations().finally(() => pool.end());
}
