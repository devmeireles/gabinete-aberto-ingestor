import { describe, expect, it } from "vitest";
import { prepareDespesasPage } from "@/application/use-cases/prepare-despesas-page";
import type { DespesaDto } from "@/application/ports/camara-gateway/despesas";

const fixture: DespesaDto = {
  ano: 2025,
  mes: 5,
  tipoDespesa: "PASSAGEM AÉREA - MISSÃO OFICIAL",
  codDocumento: "valid",
  tipoDocumento: "Nota Fiscal",
  codTipoDocumento: 0,
  dataDocumento: null,
  numDocumento: "fixture",
  parcela: 0,
  numRessarcimento: "0",
  codLote: 0,
  nomeFornecedor: "Supplier",
  cnpjCpfFornecedor: "00000000000001",
  valorDocumento: 100,
  valorGlosa: 0,
  valorLiquido: 100,
  urlDocumento: null,
};

describe("expense page preparation", () => {
  it("quarantines missing codes with their original payload and keeps valid rows", () => {
    const invalid = [null, "", "  "].map((codDocumento) => ({
      ...fixture,
      codDocumento,
    }));
    const result = prepareDespesasPage(
      [...invalid, fixture, { ...fixture, codDocumento: "0" }],
      160541,
      57,
      2025,
      5,
    );
    expect(result.expenses.map((row) => row.codDocumento)).toEqual([
      "valid",
      "0",
    ]);
    expect(result.rejectedItems).toEqual(
      invalid.map((dto) => ({
        payload: { ...dto, deputadoId: 160541, legislaturaId: 57 },
        reason: "missing_document_code",
      })),
    );
  });

  it("keeps unexpected mapping failures visible", () => {
    expect(() =>
      prepareDespesasPage(
        [{ ...fixture, valorDocumento: 1.001 }],
        160541,
        57,
        2025,
        5,
      ),
    ).toThrow("valorDocumento");
  });

  it("validates the requested period even for records with missing codes", () => {
    expect(() =>
      prepareDespesasPage(
        [{ ...fixture, mes: 6, codDocumento: null }],
        160541,
        57,
        2025,
        5,
      ),
    ).toThrow("fora do período");
  });
});
