import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("deputy party validity relations", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await executeMigration(database, "0000_init_raw_and_phase1.sql");
    await seedExistingDeputyPartyLink(database);
    await executeMigration(database, "0001_party_legislatura_relations.sql");
    await executeMigration(database, "0002_deputado_partido_vigencias.sql");
  });

  afterEach(async () => {
    await database.close();
  });

  it("preserves old party links with an explicitly unknown start date", async () => {
    const result = await database.query<{
      partido_id: number;
      data_inicio: string | null;
    }>(
      `SELECT partido_id, data_inicio::text
       FROM deputado_partido_vigencias
       WHERE deputado_id = 220593 AND legislatura_id = 57`,
    );

    expect(result.rows).toEqual([{ partido_id: 37906, data_inicio: null }]);
  });

  it("accepts a party affiliation tied to the same deputy and legislature", async () => {
    await database.exec(`
      INSERT INTO deputados (id, nome, uri, row_hash)
      VALUES (
        220594,
        'Deputado de teste',
        'https://dadosabertos.camara.leg.br/api/v2/deputados/220594',
        repeat('a', 64)
      );
      INSERT INTO deputado_legislaturas
        (deputado_id, legislatura_id, row_hash)
      VALUES (220594, 57, repeat('b', 64));
      INSERT INTO deputado_partido_vigencias
        (deputado_id, legislatura_id, partido_id, data_inicio, row_hash)
      VALUES (
        220594,
        57,
        37906,
        '2023-02-01 00:00:00',
        repeat('c', 64)
      );
    `);

    const result = await database.query<{ partido_id: number }>(
      `SELECT partido_id
       FROM deputado_partido_vigencias
       WHERE deputado_id = 220594`,
    );
    expect(result.rows[0]?.partido_id).toBe(37906);
  });

  it("rejects a party that is not associated with that legislature", async () => {
    await database.exec(`
      INSERT INTO deputados (id, nome, uri, row_hash)
      VALUES (
        220595,
        'Deputado de teste',
        'https://dadosabertos.camara.leg.br/api/v2/deputados/220595',
        repeat('a', 64)
      );
      INSERT INTO deputado_legislaturas
        (deputado_id, legislatura_id, row_hash)
      VALUES (220595, 56, repeat('b', 64));
    `);

    await expect(
      database.exec(`
        INSERT INTO deputado_partido_vigencias
          (deputado_id, legislatura_id, partido_id, data_inicio, row_hash)
        VALUES (
          220595,
          56,
          37906,
          '2019-02-01 00:00:00',
          repeat('c', 64)
        )
      `),
    ).rejects.toThrow();
  });

  it("rejects reversed validity intervals", async () => {
    await database.exec(`
      INSERT INTO deputados (id, nome, uri, row_hash)
      VALUES (
        220596,
        'Deputado de teste',
        'https://dadosabertos.camara.leg.br/api/v2/deputados/220596',
        repeat('a', 64)
      );
      INSERT INTO deputado_legislaturas
        (deputado_id, legislatura_id, row_hash)
      VALUES (220596, 57, repeat('b', 64));
    `);

    await expect(
      database.exec(`
        INSERT INTO deputado_partido_vigencias
          (deputado_id, legislatura_id, partido_id, data_inicio, data_fim, row_hash)
        VALUES (
          220596,
          57,
          37906,
          '2026-01-01 00:00:00',
          '2025-01-01 00:00:00',
          repeat('c', 64)
        )
      `),
    ).rejects.toThrow();
  });
});

async function seedExistingDeputyPartyLink(database: PGlite): Promise<void> {
  await database.exec(`
    INSERT INTO legislaturas (id, uri, data_inicio, data_fim, row_hash)
    VALUES
      (56, 'https://dadosabertos.camara.leg.br/api/v2/legislaturas/56', '2019-02-01', '2023-01-31', repeat('a', 64)),
      (57, 'https://dadosabertos.camara.leg.br/api/v2/legislaturas/57', '2023-02-01', '2027-01-31', repeat('a', 64));
    INSERT INTO partidos (id, sigla, nome, uri, row_hash)
    VALUES (
      37906,
      'PL',
      'Partido Liberal',
      'https://dadosabertos.camara.leg.br/api/v2/partidos/37906',
      repeat('a', 64)
    );
    INSERT INTO deputados (id, nome, uri, row_hash)
    VALUES (
      220593,
      'Deputado existente',
      'https://dadosabertos.camara.leg.br/api/v2/deputados/220593',
      repeat('a', 64)
    );
    INSERT INTO deputado_legislaturas
      (deputado_id, legislatura_id, partido_id, sigla_partido, row_hash)
    VALUES (220593, 57, 37906, 'PL', repeat('b', 64));
  `);
}

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
