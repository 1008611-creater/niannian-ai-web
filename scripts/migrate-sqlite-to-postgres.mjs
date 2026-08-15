import { readFile } from "node:fs/promises";
import path from "node:path";
import initSqlJs from "sql.js";
import pg from "pg";

const { Pool } = pg;
const dryRun = process.argv.includes("--dry-run");
const databaseUrl = process.env.DATABASE_URL;
const sqlitePath = process.env.SQLITE_DATABASE_PATH
  ? path.resolve(process.env.SQLITE_DATABASE_PATH)
  : path.join(process.cwd(), "data", "niannian-auth.sqlite");

if (!dryRun && !databaseUrl) {
  throw new Error("DATABASE_URL is required unless --dry-run is used");
}

const SQL = await initSqlJs({
  locateFile: (file) => path.join(process.cwd(), "node_modules", "sql.js", "dist", file),
});
const sqlite = new SQL.Database(await readFile(sqlitePath));
const statement = sqlite.prepare(
  "SELECT id, email, password_hash, password_salt, created_at FROM users ORDER BY created_at",
);
const users = [];

while (statement.step()) users.push(statement.getAsObject());
statement.free();
sqlite.close();

if (dryRun) {
  console.log(JSON.stringify({ sqlitePath, usersFound: users.length, migrated: false }));
} else {
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    await client.query("BEGIN");
    for (const user of users) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, password_salt, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           password_salt = EXCLUDED.password_salt`,
        [user.id, user.email, user.password_hash, user.password_salt, user.created_at],
      );
    }
    const verification = users.length
      ? await client.query(
          `SELECT email, password_hash, password_salt
             FROM users
            WHERE email = ANY($1::text[])`,
          [users.map((user) => user.email)],
        )
      : { rows: [] };
    const migratedByEmail = new Map(
      verification.rows.map((user) => [user.email, user]),
    );
    const verifiedUsers = users.filter((user) => {
      const migrated = migratedByEmail.get(user.email);
      return (
        migrated?.password_hash === user.password_hash &&
        migrated?.password_salt === user.password_salt
      );
    }).length;

    if (verifiedUsers !== users.length) {
      throw new Error(
        `Migration verification failed: expected ${users.length}, verified ${verifiedUsers}`,
      );
    }

    await client.query("COMMIT");
    console.log(
      JSON.stringify({
        sqlitePath,
        usersFound: users.length,
        migrated: users.length,
        verified: verifiedUsers,
      }),
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
