import { describe, expect, it } from "vitest";
import { mapDespesa } from "@/application/mappers/despesa-mapper";
import type { DespesaDto } from "@/application/ports/camara-gateway/despesas";

describe("mapDespesa", () => {
  it("preserves negative amounts and normalizes supplier tax identifiers", () => {
    const dto: DespesaDto = {
      ano: 2026,
      mes: 8,
      tipoDespesa: "PASSAGEM AÉREA - SIGEPA",
      codDocumento: "FCBAE001-4463-46FB-A36F-C1F2A2CD020C",
      tipoDocumento: "Nota Fiscal",
      codTipoDocumento: 0,
      dataDocumento: "2026-08-17T00:00:00",
      numDocumento: "TPTD5X",
      parcela: 0,
      numRessarcimento: "0",
      codLote: 0,
      nomeFornecedor: "Azul Linhas Aéreas",
      cnpjCpfFornecedor: "09.296.295/0001-60",
      valorDocumento: -32.87,
      valorGlosa: -0.01,
      valorLiquido: -32.87,
      urlDocumento: null,
    };

    expect(mapDespesa(dto, 220593, 57)).toMatchObject({
      deputadoId: 220593,
      legislaturaId: 57,
      cnpjCpfFornecedor: "09296295000160",
      valorDocumento: -32.87,
      valorGlosa: -0.01,
      valorLiquido: -32.87,
    });
  });

  it("rejects amounts with more precision than cents", () => {
    const dto: DespesaDto = {
      ano: 2025,
      mes: 4,
      tipoDespesa: "TESTE",
      codDocumento: "302323",
      tipoDocumento: "Nota Fiscal",
      codTipoDocumento: 0,
      dataDocumento: null,
      numDocumento: "BFBWSI",
      parcela: 0,
      numRessarcimento: "0",
      codLote: 0,
      nomeFornecedor: "AZUL",
      cnpjCpfFornecedor: "09296295000160",
      valorDocumento: 1.001,
      valorGlosa: 0,
      valorLiquido: 1.001,
      urlDocumento: null,
    };

    expect(() => mapDespesa(dto, 218086, 57)).toThrow(
      "Campo monetário inválido na despesa: valorDocumento",
    );
  });
});
