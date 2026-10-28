import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("deputado details migration", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await executeMigration(database, "0000_init_raw_and_phase1.sql");
    await executeMigration(database, "0007_deputado_details.sql");
    await executeMigration(database, "0008_deputado_status_snapshot.sql");
    await executeMigration(database, "0011_deputy_profile_last_fetched.sql");
    await database.exec(`
      INSERT INTO raw_payloads (request_key, content_hash, payload)
      VALUES ('deputados/218086', repeat('a', 64), '{"dados": {}}');
      INSERT INTO legislaturas (id, uri, data_inicio, data_fim, row_hash)
      VALUES (
        57,
        'https://dadosabertos.camara.leg.br/api/v2/legislaturas/57',
        '2023-02-01',
        '2027-01-31',
        repeat('b', 64)
      );
      INSERT INTO deputados (id, nome, uri, row_hash)
      VALUES (
        218086,
        'Ely Santos',
        'https://dadosabertos.camara.leg.br/api/v2/deputados/218086',
        repeat('c', 64)
      );
    `);
  });

  afterEach(async () => {
    await database.close();
  });

  it("stores profile data and the latest status snapshot", async () => {
    await database.exec(`
      INSERT INTO deputado_detalhes (
        deputado_id, nome_civil, cpf, redes_sociais, status_legislatura_id,
        status_nome, status_uri, nome_eleitoral, situacao, row_hash,
        source_payload_id, last_fetched_at
      ) VALUES (
        218086, 'ELIANE DE SOUSA ALVES', '16810770860',
        '["https://instagram.com/deputadafederal_elysantos"]', 57,
        'Ely Santos',
        'https://dadosabertos.camara.leg.br/api/v2/deputados/218086',
        'Ely Santos', 'Suplência', repeat('d', 64), 1, now()
      );
    `);

    const result = await database.query<{
      nome_civil: string;
      status_nome: string;
      redes_sociais: string[];
      last_fetched_at: string;
    }>(
      `SELECT nome_civil, status_nome, redes_sociais, last_fetched_at::text
       FROM deputado_detalhes
       WHERE deputado_id = 218086`,
    );

    expect(result.rows).toEqual([
      {
        nome_civil: "ELIANE DE SOUSA ALVES",
        status_nome: "Ely Santos",
        redes_sociais: ["https://instagram.com/deputadafederal_elysantos"],
        last_fetched_at: expect.any(String),
      },
    ]);
  });

  it("enforces references to the deputy, legislature, and raw payload", async () => {
    await expect(
      database.exec(`
        INSERT INTO deputado_detalhes (
          deputado_id, status_legislatura_id, status_uri, row_hash,
          source_payload_id
        ) VALUES (
          999, 57, 'https://dadosabertos.camara.leg.br/api/v2/deputados/999',
          repeat('e', 64), 1
        )
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
