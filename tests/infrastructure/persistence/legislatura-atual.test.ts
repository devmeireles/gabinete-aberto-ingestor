import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DrizzleDespesaRepository } from "@/infrastructure/persistence/drizzle-despesa-repository";
import * as schema from "@/infrastructure/persistence/schema";

describe("current legislature persistence", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await executeMigration(database, "0000_init_raw_and_phase1.sql");
    await executeMigration(database, "0004_legislatura_atual.sql");
    await database.exec(`
      INSERT INTO legislaturas (id, uri, data_inicio, data_fim, row_hash)
      VALUES
        (56, 'https://dadosabertos.camara.leg.br/api/v2/legislaturas/56', '2019-02-01', '2023-01-31', repeat('a', 64)),
        (57, 'https://dadosabertos.camara.leg.br/api/v2/legislaturas/57', '2023-02-01', '2027-01-31', repeat('b', 64)),
        (58, 'https://dadosabertos.camara.leg.br/api/v2/legislaturas/58', '2027-02-01', '2031-01-31', repeat('c', 64));
    `);
  });

  afterEach(async () => {
    await database.close();
  });

  it("refreshes the boolean flag for the supplied current date", async () => {
    const repository = new DrizzleDespesaRepository(
      drizzle(database, { schema }),
    );

    await expect(repository.getActiveLegislaturaId("2026-10-28")).resolves.toBe(
      57,
    );

    const result = await database.query<{
      id: number;
      legislatura_atual: boolean;
    }>(`SELECT id, legislatura_atual FROM legislaturas ORDER BY id`);
    expect(result.rows).toEqual([
      { id: 56, legislatura_atual: false },
      { id: 57, legislatura_atual: true },
      { id: 58, legislatura_atual: false },
    ]);
  });
});

async function executeMigration(
  database: PGlite,
  filename: string,
): Promise<void> {
  const sql: string = await readFile(
    new URL(`../../../drizzle/${filename}`, import.meta.url),
    "utf8",
  );
  await database.exec(sql.replace(/--> statement-breakpoint/g, ""));
}
