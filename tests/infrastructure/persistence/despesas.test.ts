import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mapDespesa } from "@/application/mappers/despesa-mapper";
import type { BilheteAereoCsv } from "@/domain/model/despesa";
import { DrizzleDespesaRepository } from "@/infrastructure/persistence/drizzle-despesa-repository";
import * as schema from "@/infrastructure/persistence/schema";

describe("expense persistence and CSV reconciliation", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await executeMigration(database, "0000_init_raw_and_phase1.sql");
    await executeMigration(database, "0001_party_legislatura_relations.sql");
    await executeMigration(database, "0002_deputado_partido_vigencias.sql");
    await executeMigration(
      database,
      "0003_expenses_and_air_ticket_enrichment.sql",
    );
    await executeMigration(database, "0004_legislatura_atual.sql");
    await executeMigration(database, "0005_silent_raider.sql");
    await executeMigration(database, "0006_bilhete_associations.sql");
    await executeMigration(database, "0012_curly_black_tarantula.sql");
    await database.exec(`
      INSERT INTO legislaturas (id, uri, data_inicio, data_fim, row_hash)
      VALUES (57, 'https://dadosabertos.camara.leg.br/api/v2/legislaturas/57', '2023-02-01', '2027-01-31', repeat('a', 64));
      INSERT INTO deputados (id, nome, uri, row_hash)
      VALUES (218086, 'Ely Santos', 'https://dadosabertos.camara.leg.br/api/v2/deputados/218086', repeat('b', 64));
      INSERT INTO deputado_legislaturas (deputado_id, legislatura_id, row_hash)
      VALUES (218086, 57, repeat('c', 64));
      INSERT INTO tipos_despesa (nome)
      VALUES ('PASSAGEM AÉREA - SIGEPA');
      INSERT INTO fornecedores (nome, cnpj_cpf)
      VALUES ('AZUL', '09296295000160');
      INSERT INTO raw_payloads (request_key, content_hash, payload)
      VALUES ('fixture', repeat('d', 64), '{}'::jsonb);
    `);
  });

  afterEach(async () => {
    await database.close();
  });

  it("upserts negative expenses and only enriches unambiguous CSV matches", async () => {
    const repository = new DrizzleDespesaRepository(
      drizzle(database, { schema }),
    );
    const rawPayload = await database.query<{ id: number }>(
      "SELECT id FROM raw_payloads WHERE request_key = 'fixture'",
    );
    const sourcePayloadId: number = rawPayload.rows[0]!.id;
    const expense = mapDespesa(
      {
        ano: 2025,
        mes: 4,
        tipoDespesa: "PASSAGEM AÉREA - SIGEPA",
        codDocumento: "302323",
        tipoDocumento: "Nota Fiscal",
        codTipoDocumento: 0,
        dataDocumento: "2025-04-08T12:00:00",
        numDocumento: "BFBWSI",
        parcela: 0,
        numRessarcimento: "0",
        codLote: 0,
        nomeFornecedor: "AZUL",
        cnpjCpfFornecedor: "09296295000160",
        valorDocumento: -391.23,
        valorGlosa: 0,
        valorLiquido: -391.23,
        urlDocumento: null,
      },
      218086,
      57,
    );
    expect(
      await repository.upsertMany([expense], sourcePayloadId),
    ).toMatchObject({
      written: 1,
      unchanged: 0,
    });

    await repository.importBilhetesCsv([csvTicket("BSB/CGH")]);
    expect(await repository.enrichFromBilhetesCsv()).toEqual({
      enriched: 1,
      ambiguous: 0,
    });
    let rows = await database.query<{
      valor_documento: string;
      passageiro: string | null;
      trecho: string | null;
      bilhete_match_ambiguo: boolean;
    }>(
      `SELECT valor_documento, passageiro, trecho, bilhete_match_ambiguo
       FROM despesas WHERE cod_documento = '302323'`,
    );
    expect(rows.rows[0]).toEqual({
      valor_documento: "-391.23",
      passageiro: "Eliane de Sousa Alves",
      trecho: "BSB/CGH",
      bilhete_match_ambiguo: false,
    });
    const associatedTicket = await database.query<{
      status: string;
      associated_expense_id: string;
    }>(
      `SELECT status, associated_expense_id::text
       FROM bilhetes_aereos_csv`,
    );
    expect(associatedTicket.rows[0]).toEqual({
      status: "associated",
      associated_expense_id: "1",
    });

    await repository.importBilhetesCsv([csvTicket("CGH/BSB")]);
    expect(await repository.enrichFromBilhetesCsv()).toEqual({
      enriched: 0,
      ambiguous: 1,
    });
    const ambiguousRows = await database.query<{
      passageiro: string | null;
      trecho: string | null;
      bilhete_match_ambiguo: boolean;
    }>(
      `SELECT passageiro, trecho, bilhete_match_ambiguo
       FROM despesas WHERE cod_documento = '302323'`,
    );
    expect(ambiguousRows.rows[0]).toEqual({
      passageiro: null,
      trecho: null,
      bilhete_match_ambiguo: true,
    });
    const availableTickets = await database.query<{ status: string }>(
      `SELECT status FROM bilhetes_aereos_csv ORDER BY id`,
    );
    expect(availableTickets.rows).toEqual([
      { status: "available" },
      { status: "available" },
    ]);

    await repository.upsertMany(
      [
        {
          ...expense,
          valorDocumento: -400,
          valorLiquido: -400,
        },
      ],
      sourcePayloadId,
    );
    const correctedRows = await database.query<{
      valor_documento: string;
      passageiro: string | null;
      trecho: string | null;
      bilhete_match_ambiguo: boolean;
    }>(
      `SELECT valor_documento, passageiro, trecho, bilhete_match_ambiguo
       FROM despesas WHERE cod_documento = '302323'`,
    );
    expect(correctedRows.rows[0]).toEqual({
      valor_documento: "-400.00",
      passageiro: null,
      trecho: null,
      bilhete_match_ambiguo: false,
    });
    const releasedTickets = await database.query<{
      status: string;
      associated_expense_id: string | null;
    }>(
      `SELECT status, associated_expense_id::text
       FROM bilhetes_aereos_csv ORDER BY id`,
    );
    expect(releasedTickets.rows).toEqual([
      { status: "available", associated_expense_id: null },
      { status: "available", associated_expense_id: null },
    ]);
  });

  it("enforces the deputy-legislature relation", async () => {
    await expect(
      database.exec(`
        INSERT INTO despesas (
          deputado_id, legislatura_id, ano, mes, tipo_despesa_id,
          cod_documento, tipo_documento, cod_tipo_documento, num_documento,
          parcela, num_ressarcimento, cod_lote, fornecedor_id,
          valor_documento, valor_glosa, valor_liquido, row_hash
        ) VALUES (
          999999, 57, 2025, 4, 1, 'x', 'Nota Fiscal', 0, 'x',
          0, '0', 0, 1, -1.00, 0, -1.00, repeat('e', 64)
        )
      `),
    ).rejects.toThrow();
  });

  it("keeps otherwise identical tickets from different categories", async () => {
    const repository = new DrizzleDespesaRepository(
      drizzle(database, { schema }),
    );
    const sigepaTicket = csvTicket("BSB/CGH");
    const rpaTicket: BilheteAereoCsv = {
      ...sigepaTicket,
      tipoDespesa: "PASSAGEM AÉREA - RPA",
    };

    await repository.importBilhetesCsv([sigepaTicket, rpaTicket]);

    const rows = await database.query<{ tipo_despesa: string }>(
      `SELECT tipo_despesa FROM bilhetes_aereos_csv ORDER BY tipo_despesa`,
    );
    expect(rows.rows).toEqual([
      { tipo_despesa: "PASSAGEM AÉREA - RPA" },
      { tipo_despesa: "PASSAGEM AÉREA - SIGEPA" },
    ]);
  });

  it("stores tickets without passenger or route without associating them", async () => {
    const repository = new DrizzleDespesaRepository(
      drizzle(database, { schema }),
    );
    const rawPayload = await database.query<{ id: number }>(
      "SELECT id FROM raw_payloads WHERE request_key = 'fixture'",
    );
    const expense = mapDespesa(
      {
        ano: 2025,
        mes: 4,
        tipoDespesa: "PASSAGEM AÉREA - SIGEPA",
        codDocumento: "302323",
        tipoDocumento: "Nota Fiscal",
        codTipoDocumento: 0,
        dataDocumento: "2025-04-08T12:00:00",
        numDocumento: "BFBWSI",
        parcela: 0,
        numRessarcimento: "0",
        codLote: 0,
        nomeFornecedor: "AZUL",
        cnpjCpfFornecedor: "09296295000160",
        valorDocumento: -391.23,
        valorGlosa: 0,
        valorLiquido: -391.23,
        urlDocumento: null,
      },
      218086,
      57,
    );
    await repository.upsertMany([expense], rawPayload.rows[0]!.id);
    await repository.importBilhetesCsv([
      { ...csvTicket(""), passageiro: "" },
    ]);

    await expect(repository.enrichFromBilhetesCsv()).resolves.toEqual({
      enriched: 0,
      ambiguous: 0,
    });
    const rows = await database.query<{
      status: string;
      associated_expense_id: string | null;
      passageiro: string | null;
      trecho: string | null;
    }>(
      `SELECT b.status, b.associated_expense_id::text,
              d.passageiro, d.trecho
       FROM bilhetes_aereos_csv b
       JOIN despesas d ON d.id = 1`,
    );
    expect(rows.rows).toEqual([
      {
        status: "available",
        associated_expense_id: null,
        passageiro: null,
        trecho: null,
      },
    ]);
  });

  it("can limit CSV reconciliation to one expense year", async () => {
    const repository = new DrizzleDespesaRepository(
      drizzle(database, { schema }),
    );
    const rawPayload = await database.query<{ id: number }>(
      "SELECT id FROM raw_payloads WHERE request_key = 'fixture'",
    );
    const expense = mapDespesa(
      {
        ano: 2025,
        mes: 4,
        tipoDespesa: "PASSAGEM AÉREA - SIGEPA",
        codDocumento: "302323",
        tipoDocumento: "Nota Fiscal",
        codTipoDocumento: 0,
        dataDocumento: "2025-04-08T12:00:00",
        numDocumento: "BFBWSI",
        parcela: 0,
        numRessarcimento: "0",
        codLote: 0,
        nomeFornecedor: "AZUL",
        cnpjCpfFornecedor: "09296295000160",
        valorDocumento: -391.23,
        valorGlosa: 0,
        valorLiquido: -391.23,
        urlDocumento: null,
      },
      218086,
      57,
    );
    await repository.upsertMany([expense], rawPayload.rows[0]!.id);
    await repository.importBilhetesCsv([csvTicket("BSB/CGH")]);

    await expect(repository.enrichFromBilhetesCsv(2024)).resolves.toEqual({
      enriched: 0,
      ambiguous: 0,
    });
    await expect(repository.enrichFromBilhetesCsv(2025)).resolves.toEqual({
      enriched: 1,
      ambiguous: 0,
    });
  });
});

function csvTicket(trecho: string): BilheteAereoCsv {
  return {
    deputadoId: 218086,
    legislaturaId: 57,
    ano: 2025,
    mes: 4,
    tipoDespesa: "PASSAGEM AÉREA - SIGEPA",
    codTipoDocumento: 0,
    codDocumento: "302323",
    dataDocumento: "2025-04-08T12:00:00",
    numDocumento: "BFBWSI",
    parcela: 0,
    codLote: 0,
    cnpjCpfFornecedor: "09296295000160",
    valorDocumento: -391.23,
    passageiro: "Eliane de Sousa Alves",
    trecho,
    arquivo: "Ano-2025.csv",
    linha: 137484,
  };
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
