import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("raw payload removal migration", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    const migrationsDir = new URL("../../../drizzle/", import.meta.url);
    for (const filename of (await readdir(migrationsDir))
      .filter((name) => name.endsWith(".sql") && !name.startsWith("0016_"))
      .sort()) {
      await executeMigration(database, filename);
    }
  });

  afterEach(async () => {
    await database.close();
  });

  it("drops source payloads without deleting normalized records", async () => {
    await database.exec(`
      INSERT INTO raw_payloads (request_key, content_hash, payload)
      VALUES
        ('deputados?pagina=1', repeat('a', 64), '{"dados": []}'),
        ('deputados?pagina=2', repeat('d', 64), '{"dados": []}');
      INSERT INTO deputados (id, nome, uri, row_hash, source_payload_id)
      VALUES (1, 'Deputado', 'https://example.test/deputados/1', repeat('b', 64), 1);
      INSERT INTO despesa_conflicts (
        source_payload_id, natural_key, row_hash, payload, reason
      ) VALUES
        (1, 'natural-key', repeat('c', 64), '{"code": "x"}', 'missing_document_code'),
        (2, 'natural-key', repeat('c', 64), '{"code": "x"}', 'missing_document_code');
    `);

    await executeMigration(database, "0016_remove_raw_payloads.sql");

    const rawTable = await database.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.raw_payloads') AS table_name",
    );
    const deputies = await database.query<{ id: number }>(
      "SELECT id FROM deputados",
    );
    const sourceColumns = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'source_payload_id'`,
    );
    const conflicts = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM despesa_conflicts",
    );

    expect(rawTable.rows[0]?.table_name).toBeNull();
    expect(deputies.rows).toEqual([{ id: 1 }]);
    expect(sourceColumns.rows[0]?.count).toBe(0);
    expect(conflicts.rows[0]?.count).toBe(1);
  });
});

async function executeMigration(
  database: PGlite,
  fileName: string,
): Promise<void> {
  const migration = await readFile(
    new URL(`../../../drizzle/${fileName}`, import.meta.url),
    "utf8",
  );
  const statements: string[] = migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");
  for (const statement of statements) {
    await database.exec(statement);
  }
}
