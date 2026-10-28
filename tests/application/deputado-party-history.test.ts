import { describe, expect, it } from "vitest";
import { mapDeputadoPartidoVigencias } from "@/application/mappers/deputado-partido-historico-mapper";
import { mapDeputado } from "@/application/mappers/deputado-mapper";
import { normalizeDeputadoPage } from "@/application/normalizers/deputado-page-normalizer";
import type {
  DeputadoDto,
  DeputadoHistoricoDto,
} from "@/application/ports/camara-gateway/deputados";

function historyEvent(
  id: number,
  idLegislatura: number,
  dataHora: string,
  partidoId: number | null,
): DeputadoHistoricoDto {
  return {
    id,
    idLegislatura,
    dataHora,
    siglaPartido: partidoId === null ? null : "PARTIDO",
    uriPartido:
      partidoId === null
        ? null
        : `https://dadosabertos.camara.leg.br/api/v2/partidos/${partidoId}`,
  };
}

function deputado(id: number, nome: string): ReturnType<typeof mapDeputado> {
  const dto: DeputadoDto = {
    id,
    idLegislatura: 57,
    nome,
    siglaPartido: "MDB",
    siglaUf: "AM",
    uri: `https://dadosabertos.camara.leg.br/api/v2/deputados/${id}`,
    uriPartido: "https://dadosabertos.camara.leg.br/api/v2/partidos/36899",
    urlFoto: "https://example.test/photo.jpg",
    email: null,
  };
  return mapDeputado(dto, 57);
}

describe("deputado party history", () => {
  it("maps party changes to non-overlapping validity periods", () => {
    const result = mapDeputadoPartidoVigencias(
      220714,
      57,
      [
        historyEvent(220714, 58, "2027-02-01T00:00", 36899),
        historyEvent(220714, 57, "2023-02-01T12:05", 37908),
        historyEvent(220714, 57, "2023-02-01T00:00", 37908),
        historyEvent(220714, 57, "2026-04-01T14:00", 36899),
      ],
      new Map([
        [36899, "MDB"],
        [37908, "REPUBLICANOS"],
      ]),
    );

    expect(result).toEqual([
      {
        deputadoId: 220714,
        legislaturaId: 57,
        partidoId: 37908,
        dataInicio: "2023-02-01T00:00:00",
        dataFim: "2026-04-01T14:00:00",
      },
      {
        deputadoId: 220714,
        legislaturaId: 57,
        partidoId: 36899,
        dataInicio: "2026-04-01T14:00:00",
        dataFim: null,
      },
    ]);
  });

  it("rejects a historical party missing from the legislature registry", () => {
    expect(() =>
      mapDeputadoPartidoVigencias(
        220714,
        57,
        [historyEvent(220714, 57, "2023-02-01T00:00", 36899)],
        new Map(),
      ),
    ).toThrow("partido 36899 do histórico do deputado 220714");
  });

  it("rejects conflicting party changes at the same timestamp", () => {
    expect(() =>
      mapDeputadoPartidoVigencias(
        220714,
        57,
        [
          historyEvent(220714, 57, "2023-02-01T00:00", 36899),
          historyEvent(220714, 57, "2023-02-01T00:00:00", 37908),
        ],
        new Map([
          [36899, "MDB"],
          [37908, "REPUBLICANOS"],
        ]),
      ),
    ).toThrow("partidos diferentes no mesmo instante");
  });

  it("deduplicates deputies returned more than once by the list endpoint", () => {
    const result = normalizeDeputadoPage([
      deputado(220714, "Adail Filho"),
      deputado(220714, "Adail"),
      deputado(220715, "Outra Deputada"),
    ]);

    expect(result.items.map((item) => item.deputado.nome)).toEqual([
      "Adail Filho",
      "Outra Deputada",
    ]);
    expect(result.duplicateRecords).toBe(1);
    expect(result.deputadoIds).toEqual([220714, 220715]);
  });

  it("excludes deputies already emitted by earlier pages", () => {
    const result = normalizeDeputadoPage(
      [deputado(220714, "Adail Filho")],
      new Set([220714]),
    );

    expect(result.items).toEqual([]);
    expect(result.duplicateRecords).toBe(1);
  });
});
