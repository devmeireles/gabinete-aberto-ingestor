import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { ImportBilhetesAereosCsv } from "@/application/use-cases/import-bilhetes-aereos-csv";
import type { DespesaRepository } from "@/application/ports/despesa-repository";
import { StreamingBilheteAereoCsvSource } from "@/infrastructure/csv/streaming-bilhete-aereo-csv-source";
import type { BilheteAereoCsv } from "@/domain/model/despesa";

describe("ImportBilhetesAereosCsv", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory !== undefined) {
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  it("streams quoted semicolon CSV and keeps the negative-amount route match", async () => {
    directory = await mkdtemp(join(tmpdir(), "camara-expense-csv-"));
    const filePath = join(directory, "Ano-2025.csv");
    const header =
      '"txtDescricao";"indTipoDocumento";"nuDeputadoId";"codLegislatura";"numAno";"numMes";"ideDocumento";"datEmissao";"txtNumero";"numParcela";"numLote";"txtCNPJCPF";"vlrDocumento";"txtPassageiro";"txtTrecho"\n';
    const rows =
      '"PASSAGEM AÉREA - SIGEPA";"0";"218086";"57";"2025";"4";"302323";"2025-04-08T12:00:00";"BFBWSI";"0";"0";"092.962.950/0016-0";"-391.23";"Eliane; de Sousa Alves";"BSB/CGH"\n' +
      '"PASSAGEM AÉREA - RPA";"0";"218086";"57";"2025";"4";"302324";"2025-04-08T12:00:00";"BFBWSJ";"0";"0";"092.962.950/0016-0";"391.23";"Eliane de Sousa Alves";"BSB/CGH"\n' +
      '"PASSAGEM AÉREA - REEMBOLSO";"0";"218086";"57";"2025";"4";"302325";"2025-04-08T12:00:00";"BFBWSK";"0";"0";"092.962.950/0016-0";"391.23";"Eliane de Sousa Alves";"BSB/CGH"\n' +
      '"PASSAGEM AÉREA - MISSÃO OFICIAL";"0";"218086";"57";"2025";"4";"302326";"2025-04-08T12:00:00";"BFBWSL";"0";"0";"092.962.950/0016-0";"391.23";"Eliane de Sousa Alves";"BSB/CGH"\n' +
      '"OUTRA DESPESA";"0";"218086";"57";"2025";"4";"302324";"2025-04-08T12:00:00";"BFBWSJ";"0";"0";"092.962.950/0016-0";"10.00";"";""\n';
    await writeFile(filePath, `\uFEFF${header}${rows}`, "utf8");

    let imported: readonly BilheteAereoCsv[] = [];
    const repository: DespesaRepository = {
      getActiveLegislaturaId: async () => 57,
      listDeputadoIds: async () => [218086],
      upsertMany: async () => ({
        written: 0,
        unchanged: 0,
        conflicted: 0,
        enriched: 0,
        ambiguous: 0,
      }),
      importBilhetesCsv: async (items) => {
        imported = [...imported, ...items];
        return { imported: items.length, enriched: 0, ambiguous: 0 };
      },
      enrichFromBilhetesCsv: async () => ({ enriched: 1, ambiguous: 0 }),
    };

    const result = await new ImportBilhetesAereosCsv(
      new StreamingBilheteAereoCsvSource(),
      repository,
    ).execute(filePath);

    expect(result).toEqual({
      scanned: 5,
      candidates: 4,
      imported: 4,
      enriched: 1,
      ambiguous: 0,
    });
    expect(imported[0]).toMatchObject({
      deputadoId: 218086,
      legislaturaId: 57,
      ano: 2025,
      mes: 4,
      codDocumento: "302323",
      valorDocumento: -391.23,
      passageiro: "Eliane; de Sousa Alves",
      trecho: "BSB/CGH",
      cnpjCpfFornecedor: "09296295000160",
    });
    expect(imported.map(({ tipoDespesa }) => tipoDespesa)).toEqual([
      "PASSAGEM AÉREA - SIGEPA",
      "PASSAGEM AÉREA - RPA",
      "PASSAGEM AÉREA - REEMBOLSO",
      "PASSAGEM AÉREA - MISSÃO OFICIAL",
    ]);
  });

  it("retains official-mission CSV rows with an empty document code and continues streaming", async () => {
    const csv =
      '"txtDescricao";"indTipoDocumento";"nuDeputadoId";"codLegislatura";"numAno";"numMes";"ideDocumento";"datEmissao";"txtNumero";"numParcela";"numLote";"txtCNPJCPF";"vlrDocumento";"txtPassageiro";"txtTrecho"\n' +
      '"PASSAGEM AÉREA - MISSÃO OFICIAL";"0";"218086";"57";"2025";"4";"";"2025-04-08T12:00:00";"BFBWSL";"0";"0";"092.962.950/0016-0";"391.23";"Passenger";"BSB/CGH"\n' +
      '"PASSAGEM AÉREA - MISSÃO OFICIAL";"0";"218086";"57";"2025";"4";"302326";"2025-04-08T12:00:00";"BFBWSM";"0";"0";"092.962.950/0016-0";"391.23";"Passenger";"CGH/BSB"\n';
    const items = [];
    for await (const item of new StreamingBilheteAereoCsvSource().readStream(
      "Ano-2025.csv",
      Readable.from([Buffer.from(csv)]),
    )) {
      items.push(item);
    }
    expect(items.map(({ codDocumento }) => codDocumento)).toEqual([
      "",
      "302326",
    ]);
    expect(items[0]).toMatchObject({
      tipoDespesa: "PASSAGEM AÉREA - MISSÃO OFICIAL",
      passageiro: "Passenger",
      trecho: "BSB/CGH",
    });
  });

  it("previews CSV candidates without requiring or calling a repository", async () => {
    directory = await mkdtemp(join(tmpdir(), "camara-expense-csv-preview-"));
    const filePath = join(directory, "Ano-2025.csv");
    const header =
      '"txtDescricao";"indTipoDocumento";"nuDeputadoId";"codLegislatura";"numAno";"numMes";"ideDocumento";"datEmissao";"txtNumero";"numParcela";"numLote";"txtCNPJCPF";"vlrDocumento";"txtPassageiro";"txtTrecho"\n';
    const row =
      '"PASSAGEM AÉREA - SIGEPA";"0";"218086";"57";"2025";"4";"302323";"2025-04-08T12:00:00";"BFBWSI";"0";"0";"092.962.950/0016-0";"-391.23";"Eliane de Sousa Alves";"BSB/CGH"\n';
    await writeFile(filePath, `${header}${row}`, "utf8");

    const result = await new ImportBilhetesAereosCsv(
      new StreamingBilheteAereoCsvSource(),
    ).preview(filePath);

    expect(result).toMatchObject({
      scanned: 1,
      candidates: 1,
      sample: {
        deputadoId: 218086,
        codDocumento: "302323",
        valorDocumento: -391.23,
        passageiro: "Eliane de Sousa Alves",
        trecho: "BSB/CGH",
      },
    });
  });

  it("imports candidates when passenger and route columns are absent", async () => {
    const csv =
      '"txtDescricao";"indTipoDocumento";"nuDeputadoId";"codLegislatura";"numAno";"numMes";"ideDocumento";"datEmissao";"txtNumero";"numParcela";"numLote";"txtCNPJCPF";"vlrDocumento"\n' +
      '"PASSAGEM AÉREA - SIGEPA";"0";"218086";"57";"2025";"4";"302323";"2025-04-08T12:00:00";"BFBWSI";"0";"0";"092.962.950/0016-0";"-391.23"\n';
    const imported: BilheteAereoCsv[] = [];
    const repository: DespesaRepository = {
      getActiveLegislaturaId: async () => 57,
      listDeputadoIds: async () => [218086],
      upsertMany: async () => ({
        written: 0,
        unchanged: 0,
        conflicted: 0,
        enriched: 0,
        ambiguous: 0,
      }),
      importBilhetesCsv: async (items) => {
        imported.push(...items);
        return { imported: items.length, enriched: 0, ambiguous: 0 };
      },
      enrichFromBilhetesCsv: async () => ({ enriched: 0, ambiguous: 0 }),
    };

    await new ImportBilhetesAereosCsv(
      new StreamingBilheteAereoCsvSource(),
      repository,
    ).importStream("Ano-2025.csv", Readable.from([Buffer.from(csv)]));

    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({ passageiro: "", trecho: "" });
  });

  it("imports a decompressed stream without reconciling until requested", async () => {
    const csv =
      '"txtDescricao";"indTipoDocumento";"nuDeputadoId";"codLegislatura";"numAno";"numMes";"ideDocumento";"datEmissao";"txtNumero";"numParcela";"numLote";"txtCNPJCPF";"vlrDocumento";"txtPassageiro";"txtTrecho"\n' +
      '"PASSAGEM AÉREA - SIGEPA";"0";"218086";"57";"2025";"4";"302323";"2025-04-08T12:00:00";"BFBWSI";"0";"0";"092.962.950/0016-0";"-391.23";"Eliane de Sousa Alves";"BSB/CGH"\n';
    const batches: BilheteAereoCsv[][] = [];
    let reconciliations: number = 0;
    const repository: DespesaRepository = {
      getActiveLegislaturaId: async () => 57,
      listDeputadoIds: async () => [218086],
      upsertMany: async () => ({
        written: 0,
        unchanged: 0,
        conflicted: 0,
        enriched: 0,
        ambiguous: 0,
      }),
      importBilhetesCsv: async (items) => {
        batches.push([...items]);
        return { imported: items.length, enriched: 0, ambiguous: 0 };
      },
      enrichFromBilhetesCsv: async () => {
        reconciliations++;
        return { enriched: 1, ambiguous: 0 };
      },
    };

    const importer = new ImportBilhetesAereosCsv(
      new StreamingBilheteAereoCsvSource(),
      repository,
    );
    const result = await importer.importStream(
      "Ano-2025.csv",
      Readable.from([Buffer.from(csv)]),
    );

    expect(result).toEqual({
      scanned: 1,
      candidates: 1,
      imported: 1,
      enriched: 0,
      ambiguous: 0,
    });
    expect(batches).toHaveLength(1);
    expect(reconciliations).toBe(0);
    await expect(importer.reconcile()).resolves.toEqual({
      enriched: 1,
      ambiguous: 0,
    });
    expect(reconciliations).toBe(1);
  });
});
