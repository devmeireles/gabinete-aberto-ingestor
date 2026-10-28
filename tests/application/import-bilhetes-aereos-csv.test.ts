import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
      '"OUTRA DESPESA";"0";"218086";"57";"2025";"4";"302324";"2025-04-08T12:00:00";"BFBWSJ";"0";"0";"092.962.950/0016-0";"10.00";"";""\n';
    await writeFile(filePath, `\uFEFF${header}${rows}`, "utf8");

    let imported: readonly BilheteAereoCsv[] = [];
    const repository: DespesaRepository = {
      getActiveLegislaturaId: async () => 57,
      listDeputadoIds: async () => [218086],
      upsertMany: async () => ({
        written: 0,
        unchanged: 0,
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
      scanned: 2,
      candidates: 1,
      imported: 1,
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
});
