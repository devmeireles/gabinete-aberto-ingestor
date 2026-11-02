import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("partido details migration", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    const migrationsDir = new URL("../../../drizzle/", import.meta.url);
    for (const filename of (await readdir(migrationsDir))
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      await executeMigration(database, filename);
    }
    await database.exec(`
      INSERT INTO legislaturas (id, uri, data_inicio, data_fim, row_hash)
      VALUES (
        57,
        'https://dadosabertos.camara.leg.br/api/v2/legislaturas/57',
        '2023-02-01',
        '2027-01-31',
        repeat('b', 64)
      );
      INSERT INTO partidos (id, sigla, nome, uri, row_hash)
      VALUES (
        37906,
        'PL',
        'Partido Liberal',
        'https://dadosabertos.camara.leg.br/api/v2/partidos/37906',
        repeat('c', 64)
      );
    `);
  });

  afterEach(async () => {
    await database.close();
  });

  it("stores party status and leader details", async () => {
    await database.exec(`
      INSERT INTO partido_detalhes (
        partido_id, status_data, status_legislatura_id, situacao,
        total_posse, total_membros, lider_nome, lider_uf, numero_eleitoral,
          url_logo, row_hash, last_fetched_at
      ) VALUES (
        37906, '2026-03-31T12:27', 57, 'Ativo', 98, 98, 'Bia Kicis',
        'DF', NULL,
        'https://www.camara.leg.br/internet/Deputado/img/partidos/PL.gif',
          repeat('d', 64), now()
      );
    `);

    const result = await database.query<{
      situacao: string;
      total_membros: number;
      lider_nome: string;
      last_fetched_at: string;
    }>(
      `SELECT situacao, total_membros, lider_nome, last_fetched_at::text
       FROM partido_detalhes
       WHERE partido_id = 37906`,
    );

    expect(result.rows).toEqual([
      {
        situacao: "Ativo",
        total_membros: 98,
        lider_nome: "Bia Kicis",
        last_fetched_at: expect.any(String),
      },
    ]);
  });

  it("requires the listed party to exist", async () => {
    await expect(
      database.exec(`
        INSERT INTO partido_detalhes (
          partido_id, row_hash
        ) VALUES (999, repeat('e', 64))
      `),
    ).rejects.toThrow();
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
    .map((statement: string) => statement.trim())
    .filter((statement: string) => statement !== "");
  for (const statement of statements) {
    await database.exec(statement);
  }
}
