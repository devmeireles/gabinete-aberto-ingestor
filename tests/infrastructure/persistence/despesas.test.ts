import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mapDespesa } from "@/application/mappers/despesa-mapper";
import { SyncDespesas } from "@/application/use-cases/sync-despesas";
import type { DespesaDto } from "@/application/ports/camara-gateway/despesas";
import { DrizzleRawPayloadStore } from "@/infrastructure/persistence/drizzle-raw-payload-store";
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
    await executeMigration(database, "0013_round_colossus.sql");
    await executeMigration(
      database,
      "0014_expense_document_identity_and_conflicts.sql",
    );
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

  it("writes an identical natural-key expense only once per page", async () => {
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

    await expect(
      repository.upsertMany([expense, expense], rawPayload.rows[0]!.id),
    ).resolves.toMatchObject({ written: 1, unchanged: 1 });
    const rows = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM despesas",
    );
    expect(rows.rows[0]?.count).toBe("1");
  });

  it("preserves same-key expenses with different monetary values", async () => {
    const repository = new DrizzleDespesaRepository(
      drizzle(database, { schema }),
    );
    await database.exec(`
      INSERT INTO deputados (id, nome, uri, row_hash)
      VALUES (226553, 'Fixture Deputy', 'https://dadosabertos.camara.leg.br/api/v2/deputados/226553', repeat('e', 64));
      INSERT INTO deputado_legislaturas (deputado_id, legislatura_id, row_hash)
      VALUES (226553, 57, repeat('f', 64));
    `);
    const rawPayload = await database.query<{ id: number }>(
      "SELECT id FROM raw_payloads WHERE request_key = 'fixture'",
    );
    const makeExpense = (valor: number) =>
      mapDespesa(
        {
          ano: 2023,
          mes: 9,
          tipoDespesa: "PASSAGEM AÉREA - SIGEPA",
          codDocumento: "186534",
          tipoDocumento: "Nota Fiscal",
          codTipoDocumento: 0,
          dataDocumento: "2023-09-11T12:00:00",
          numDocumento: "9572124755387",
          parcela: 0,
          numRessarcimento: "0",
          codLote: 0,
          nomeFornecedor: "TAM",
          cnpjCpfFornecedor: "02012862000160",
          valorDocumento: valor,
          valorGlosa: 0,
          valorLiquido: valor,
          urlDocumento: null,
        },
        226553,
        57,
      );
    const expenses = [makeExpense(59), makeExpense(1386.71)];

    await expect(
      repository.upsertMany(expenses, rawPayload.rows[0]!.id),
    ).resolves.toMatchObject({ written: 2, unchanged: 0 });
    await expect(
      repository.upsertMany(expenses, rawPayload.rows[0]!.id),
    ).resolves.toMatchObject({ written: 0, unchanged: 2 });
    const rows = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM despesas WHERE cod_documento = '186534'",
    );
    expect(rows.rows[0]?.count).toBe("2");
  });

  it("quarantines all conflicting variants while writing unrelated expenses", async () => {
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

    const conflict = { ...expense, nomeFornecedor: "Another supplier" };
    const valid = { ...expense, codDocumento: "valid" };
    const items = [expense, conflict, expense, valid, valid];
    const sourcePayloadId = rawPayload.rows[0]!.id;
    await expect(
      repository.upsertMany(items, sourcePayloadId),
    ).resolves.toMatchObject({
      written: 1,
      unchanged: 1,
      conflicted: 3,
    });
    await expect(
      repository.upsertMany(items, sourcePayloadId),
    ).resolves.toMatchObject({
      written: 0,
      unchanged: 2,
      conflicted: 3,
    });
    const rows = await database.query<{ cod_documento: string }>(
      "SELECT cod_documento FROM despesas",
    );
    expect(rows.rows).toEqual([{ cod_documento: "valid" }]);
    const quarantined = await database.query<{
      source_payload_id: number;
      natural_key: string;
      payload: unknown;
      reason: string;
    }>(
      "SELECT source_payload_id::int, natural_key, payload, reason FROM despesa_conflicts ORDER BY id",
    );
    expect(quarantined.rows).toHaveLength(2);
    expect(quarantined.rows.map((row) => row.payload)).toEqual([
      expense,
      conflict,
    ]);
    expect(quarantined.rows[0]).toMatchObject({
      source_payload_id: sourcePayloadId,
      natural_key: expect.any(String),
      reason: "same_natural_key_different_content",
    });
    await expect(
      repository.upsertMany([expense, conflict], sourcePayloadId),
    ).resolves.toEqual({
      written: 0,
      unchanged: 0,
      conflicted: 2,
      enriched: 0,
      ambiguous: 0,
    });
  });

  it("preserves the two reported phone bills and deduplicates missing document dates", async () => {
    const repository = new DrizzleDespesaRepository(
      drizzle(database, { schema }),
    );
    const makeExpense = (numDocumento: string, dataDocumento: string | null) =>
      mapDespesa(
        {
          ...fixtureExpenseDto(),
          numDocumento,
          dataDocumento,
        },
        218086,
        57,
      );
    const items = [
      makeExpense("7564976", "2023-04-15T00:00:00"),
      makeExpense("7611767", "2023-05-15T00:00:00"),
      makeExpense("undated", null),
      makeExpense("undated", "2023-04-15T00:00:00"),
    ];
    const raw = await database.query<{ id: number }>(
      "SELECT id FROM raw_payloads LIMIT 1",
    );
    const sourcePayloadId = raw.rows[0]!.id;
    await expect(
      repository.upsertMany([...items, items[2]!], sourcePayloadId),
    ).resolves.toMatchObject({
      written: 4,
      unchanged: 1,
      conflicted: 0,
    });
    await expect(
      repository.upsertMany(items, sourcePayloadId),
    ).resolves.toMatchObject({
      written: 0,
      unchanged: 4,
      conflicted: 0,
    });
    const rows = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM despesas",
    );
    expect(rows.rows[0]?.count).toBe(4);
  });

  it("continues to later pages and retains raw payloads after a conflicting page", async () => {
    const db = drizzle(database, { schema });
    const dto = fixtureExpenseDto();
    const requestedPages: number[] = [];
    const sync = new SyncDespesas(
      {
        listDespesas: async ({ pagina }) => {
          requestedPages.push(pagina);
          const items =
            pagina === 1
              ? [dto, { ...dto, nomeFornecedor: "Conflicting supplier" }]
              : [{ ...dto, numDocumento: "next-page" }];
          return {
            items,
            page: pagina,
            hasNext: pagina === 1,
            requestKey: `fixture-page-${pagina}`,
            rawBody: { dados: items },
          };
        },
      },
      new DrizzleRawPayloadStore(db),
      new DrizzleDespesaRepository(db),
    );
    await expect(
      sync.executeDeputadoMonth(218086, 57, 2023, 4),
    ).resolves.toEqual({
      pages: 2,
      fetched: 3,
      written: 1,
      unchanged: 0,
      conflicted: 2,
      enriched: 0,
      ambiguous: 0,
    });
    expect(requestedPages).toEqual([1, 2]);
    const raw = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM raw_payloads WHERE request_key LIKE 'fixture-page-%'",
    );
    expect(raw.rows[0]?.count).toBe(2);
  });

  it("quarantines missing API document codes and writes subsequent pages idempotently", async () => {
    const db = drizzle(database, { schema });
    const dto = {
      ...fixtureExpenseDto(),
      tipoDespesa: "PASSAGEM AÉREA - MISSÃO OFICIAL",
    };
    const invalid = { ...dto, codDocumento: null };
    const sync = new SyncDespesas(
      {
        listDespesas: async ({ pagina }) => {
          const items =
            pagina === 1
              ? [invalid, { ...dto, numDocumento: "valid" }]
              : [invalid];
          return {
            items,
            page: pagina,
            hasNext: pagina === 1,
            requestKey: `missing-code-page-${pagina}`,
            rawBody: { dados: items },
          };
        },
      },
      new DrizzleRawPayloadStore(db),
      new DrizzleDespesaRepository(db),
    );
    await expect(
      sync.executeDeputadoMonth(218086, 57, 2023, 4),
    ).resolves.toMatchObject({
      pages: 2,
      fetched: 3,
      written: 1,
      unchanged: 0,
      conflicted: 2,
    });
    await expect(
      sync.executeDeputadoMonth(218086, 57, 2023, 4),
    ).resolves.toMatchObject({
      pages: 2,
      fetched: 3,
      written: 0,
      unchanged: 1,
      conflicted: 2,
    });
    const quarantined = await database.query<{
      reason: string;
      payload: unknown;
      source_payload_id: number;
    }>(
      "SELECT reason, payload, source_payload_id::int FROM despesa_conflicts ORDER BY id",
    );
    expect(quarantined.rows).toHaveLength(2);
    for (const row of quarantined.rows) {
      expect(row).toMatchObject({
        reason: "missing_document_code",
        payload: { ...invalid, deputadoId: 218086, legislaturaId: 57 },
        source_payload_id: expect.any(Number),
      });
    }
  });

  it("enriches official-mission tickets but leaves tickets without document codes unassociated", async () => {
    const repository = new DrizzleDespesaRepository(
      drizzle(database, { schema }),
    );
    const ticket = {
      ...csvTicket("BSB/CGH"),
      tipoDespesa: "PASSAGEM AÉREA - MISSÃO OFICIAL",
    };
    const expense = mapDespesa(
      {
        ...fixtureExpenseDto(),
        ...ticket,
        tipoDocumento: "Nota Fiscal",
        numRessarcimento: "0",
        valorGlosa: 0,
        valorLiquido: ticket.valorDocumento,
        nomeFornecedor: "AZUL",
        urlDocumento: null,
      },
      218086,
      57,
    );
    const raw = await database.query<{ id: number }>(
      "SELECT id FROM raw_payloads LIMIT 1",
    );
    await repository.upsertMany([expense], raw.rows[0]!.id);
    await repository.importBilhetesCsv([
      ticket,
      { ...ticket, codDocumento: "", linha: ticket.linha + 1 },
    ]);
    expect(await repository.enrichFromBilhetesCsv()).toEqual({
      enriched: 1,
      ambiguous: 0,
    });
    const rows = await database.query(
      "SELECT cod_documento, status FROM bilhetes_aereos_csv ORDER BY id",
    );
    expect(rows.rows).toEqual([
      { cod_documento: ticket.codDocumento, status: "associated" },
      { cod_documento: "", status: "available" },
    ]);
  });

  it("rolls back quarantine and propagates database failures", async () => {
    const db = drizzle(database, { schema });
    const repository = new DrizzleDespesaRepository(db);
    const expense = mapDespesa(fixtureExpenseDto(), 218086, 57);
    const raw = await database.query<{ id: number }>(
      "SELECT id FROM raw_payloads LIMIT 1",
    );
    await database.exec(`
      CREATE FUNCTION reject_expense() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'fixture database failure'; END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_expense BEFORE INSERT ON despesas
      FOR EACH ROW EXECUTE FUNCTION reject_expense();
    `);
    await expect(
      repository.upsertMany(
        [
          expense,
          { ...expense, nomeFornecedor: "Conflicting supplier" },
          { ...expense, numDocumento: "valid" },
        ],
        raw.rows[0]!.id,
      ),
    ).rejects.toThrow();
    const counts = await database.query<{
      conflicts: number;
      expenses: number;
    }>(
      "SELECT (SELECT count(*)::int FROM despesa_conflicts) AS conflicts, (SELECT count(*)::int FROM despesas) AS expenses",
    );
    expect(counts.rows[0]).toEqual({ conflicts: 0, expenses: 0 });
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
    await repository.importBilhetesCsv([{ ...csvTicket(""), passageiro: "" }]);

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

function fixtureExpenseDto(): DespesaDto {
  return {
    ano: 2023,
    mes: 4,
    tipoDespesa: "TELEFONIA",
    codDocumento: "0",
    tipoDocumento: "Nota Fiscal",
    codTipoDocumento: 0,
    dataDocumento: "2023-04-15T00:00:00",
    numDocumento: "7564976",
    parcela: 0,
    numRessarcimento: "0",
    codLote: 0,
    nomeFornecedor: "CELULAR FUNCIONAL",
    cnpjCpfFornecedor: "00000000000001",
    valorDocumento: 235.8,
    valorGlosa: 0,
    valorLiquido: 235.8,
    urlDocumento: null,
  };
}
