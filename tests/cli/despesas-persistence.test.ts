import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ListDespesasQuery } from "@/application/ports/camara-gateway/despesas";
import { runDespesas } from "@/cli/despesas";
import * as schema from "@/infrastructure/persistence/schema";

const harness = vi.hoisted(() => ({
  createDatabase: vi.fn(),
  listDespesas: vi.fn(),
  end: vi.fn(),
}));

vi.mock("@/infrastructure/persistence/client", () => ({
  createDatabase: harness.createDatabase,
}));
vi.mock("@/infrastructure/camara/http-camara-gateway", () => ({
  HttpCamaraGateway: class {
    listDespesas = harness.listDespesas;
  },
}));

const backfillArgs = [
  "--legislatura=57",
  "--desde=2024-03",
  "--ate=2024-04",
  "--persist",
];

describe("local expense backfill persistence and run tracking", () => {
  let database: PGlite;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("DATABASE_URL", "postgres://fixture/unused");
    vi.spyOn(console, "log").mockImplementation(() => {});
    database = new PGlite();
    const migrationsDir = new URL("../../drizzle/", import.meta.url);
    for (const filename of (await readdir(migrationsDir))
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      const migration = await readFile(
        new URL(filename, migrationsDir),
        "utf8",
      );
      await database.exec(migration.replace(/--> statement-breakpoint/g, ""));
    }
    await database.exec(`
      INSERT INTO legislaturas (id, uri, data_inicio, data_fim, row_hash)
      VALUES (57, 'fixture', '2023-02-01', '2027-01-31', repeat('a', 64));
      INSERT INTO deputados (id, nome, uri, row_hash)
      VALUES (1, 'One', 'fixture-1', repeat('b', 64)), (2, 'Two', 'fixture-2', repeat('c', 64));
      INSERT INTO deputado_legislaturas (deputado_id, legislatura_id, row_hash)
      VALUES (1, 57, repeat('d', 64)), (2, 57, repeat('e', 64));
    `);
    harness.createDatabase.mockReturnValue({
      db: drizzle(database, { schema }),
      pool: { end: harness.end },
    });
    harness.listDespesas.mockImplementation(
      async (query: ListDespesasQuery) => {
        const dto = {
          ano: query.ano,
          mes: query.mes,
          tipoDespesa: "TELEFONIA",
          codDocumento: "0",
          tipoDocumento: "Nota Fiscal",
          codTipoDocumento: 0,
          dataDocumento: null,
          numDocumento: "conflict",
          parcela: 0,
          numRessarcimento: "0",
          codLote: 0,
          nomeFornecedor: "Supplier",
          cnpjCpfFornecedor: "00000000000001",
          valorDocumento: 235.8,
          valorGlosa: 0,
          valorLiquido: 235.8,
          urlDocumento: null,
        };
        const items =
          query.pagina === 1
            ? [
                dto,
                { ...dto, nomeFornecedor: "Other supplier" },
                { ...dto, numDocumento: "valid" },
              ]
            : [{ ...dto, numDocumento: "next-page" }];
        return {
          items,
          page: query.pagina,
          hasNext: query.pagina === 1,
          requestKey: `fixture-${query.idDeputado}-${query.ano}-${query.mes}-${query.pagina}`,
          rawBody: { dados: items },
        };
      },
    );
  });

  afterEach(async () => {
    await database.close();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("tracks each deputy/month, persists raw and quarantine data, and supports reruns", async () => {
    await runDespesas(backfillArgs);
    const runs = await database.query<{
      function_id: string;
      event_name: string;
      attempt: number;
      status: string;
      summary: Record<string, unknown>;
      finished_at: string;
    }>(
      "SELECT function_id, event_name, attempt, status, summary, finished_at::text FROM crawler_runs ORDER BY id",
    );
    expect(runs.rows).toHaveLength(4);
    expect(
      runs.rows.map((row) => [row.summary.deputadoId, row.summary.mes]),
    ).toEqual([
      [1, 3],
      [1, 4],
      [2, 3],
      [2, 4],
    ]);
    for (const row of runs.rows) {
      expect(row).toMatchObject({
        function_id: "cli-despesas-month",
        event_name: "cli/despesas.backfill.month",
        attempt: 1,
        status: "completed",
        finished_at: expect.any(String),
        summary: {
          source: "cli",
          legislaturaId: 57,
          ano: 2024,
          pages: 2,
          fetched: 4,
          written: 2,
          unchanged: 0,
          conflicted: 2,
          truncated: false,
        },
      });
    }
    await runDespesas(backfillArgs);
    const counts = await database.query(
      `SELECT (SELECT count(*)::int FROM despesas) AS expenses,
       (SELECT count(*)::int FROM raw_payloads) AS raw,
       (SELECT count(*)::int FROM despesa_conflicts) AS conflicts,
       (SELECT count(*)::int FROM crawler_runs) AS runs`,
    );
    expect(counts.rows[0]).toEqual({
      expenses: 8,
      raw: 8,
      conflicts: 8,
      runs: 8,
    });
    const rerun = await database.query<{ summary: Record<string, unknown> }>(
      "SELECT summary FROM crawler_runs ORDER BY id DESC LIMIT 1",
    );
    expect(rerun.rows[0]?.summary).toMatchObject({
      written: 0,
      unchanged: 2,
      conflicted: 2,
    });
    expect(harness.end).toHaveBeenCalledTimes(2);
  });

  it("completes tracked months with missing document codes and proceeds to other deputies", async () => {
    const original = harness.listDespesas.getMockImplementation()!;
    harness.listDespesas.mockImplementation(
      async (query: ListDespesasQuery) => {
        const page = await original(query);
        if (query.idDeputado === 1 && query.mes === 3 && query.pagina === 1) {
          const items = [
            {
              ...page.items[0],
              tipoDespesa: "PASSAGEM AÉREA - MISSÃO OFICIAL",
              codDocumento: null,
            },
          ];
          return { ...page, items, rawBody: { dados: items } };
        }
        return page;
      },
    );
    await runDespesas(backfillArgs);
    const runs = await database.query<{
      status: string;
      summary: Record<string, unknown>;
    }>("SELECT status, summary FROM crawler_runs ORDER BY id");
    expect(runs.rows).toHaveLength(4);
    expect(runs.rows.every(({ status }) => status === "completed")).toBe(true);
    expect(runs.rows[0]?.summary).toMatchObject({
      fetched: 2,
      written: 1,
      conflicted: 1,
      pages: 2,
    });
    const quarantine = await database.query<{
      payload: Record<string, unknown>;
    }>(
      "SELECT payload FROM despesa_conflicts WHERE reason = 'missing_document_code'",
    );
    expect(quarantine.rows).toHaveLength(1);
    expect(quarantine.rows[0]?.payload).toMatchObject({
      codDocumento: null,
      tipoDespesa: "PASSAGEM AÉREA - MISSÃO OFICIAL",
    });
  });

  it("records a failed month before propagating the error and closes the pool", async () => {
    harness.listDespesas.mockImplementation(async () => {
      const rows = await database.query<{ status: string }>(
        "SELECT status FROM crawler_runs",
      );
      expect(rows.rows).toEqual([{ status: "running" }]);
      throw new Error("fixture API failure");
    });
    await expect(runDespesas(backfillArgs)).rejects.toThrow(
      "fixture API failure",
    );
    const runs = await database.query(
      "SELECT status, error, finished_at::text FROM crawler_runs",
    );
    expect(runs.rows).toEqual([
      {
        status: "failed",
        error: "fixture API failure",
        finished_at: expect.any(String),
      },
    ]);
    expect(harness.end).toHaveBeenCalledOnce();
  });

  it("keeps dry runs free of database writes", async () => {
    await runDespesas([
      "--legislatura=57",
      "--deputado=1",
      "--ano=2024",
      "--mes=3",
      "--dry-run",
    ]);
    expect(harness.createDatabase).not.toHaveBeenCalled();
    const runs = await database.query("SELECT * FROM crawler_runs");
    expect(runs.rows).toEqual([]);
  });

  it("reports a deliberately page-limited run as truncated", async () => {
    await runDespesas([...backfillArgs, "--pages=1"]);
    const runs = await database.query<{ summary: Record<string, unknown> }>(
      "SELECT summary FROM crawler_runs",
    );
    expect(runs.rows).toHaveLength(1);
    expect(runs.rows[0]?.summary).toMatchObject({
      deputadoId: 1,
      mes: 3,
      pages: 1,
      truncated: true,
    });
  });
});
