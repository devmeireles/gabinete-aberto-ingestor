import { describe, expect, it } from "vitest";
import { mapPartidoDetalhe } from "@/application/mappers/partido-detalhe-mapper";
import type { PartidoDetalheDto } from "@/application/ports/camara-gateway/partidos";

const detalhe: PartidoDetalheDto = {
  id: 37906,
  sigla: "PL",
  nome: "Partido Liberal",
  uri: "https://dadosabertos.camara.leg.br/api/v2/partidos/37906",
  status: {
    data: "2026-03-31T12:27",
    idLegislatura: "57",
    situacao: "Ativo",
    totalPosse: "98",
    totalMembros: "98",
    uriMembros:
      "https://dadosabertos.camara.leg.br/api/v2/deputados?idLegislatura=57&siglaPartido=PL",
    lider: {
      uri: "https://dadosabertos.camara.leg.br/api/v2/deputados/204374",
      nome: "Bia Kicis",
      siglaPartido: "PL",
      uriPartido: "https://dadosabertos.camara.leg.br/api/v2/partidos/37906",
      uf: "DF",
      idLegislatura: 57,
      urlFoto: "https://www.camara.leg.br/internet/deputado/bandep/204374.jpg",
    },
  },
  numeroEleitoral: null,
  urlLogo: "https://www.camara.leg.br/internet/Deputado/img/partidos/PL.gif",
  urlWebSite: null,
  urlFacebook: null,
};

describe("mapPartidoDetalhe", () => {
  it("maps party status, leadership, and profile links", () => {
    expect(mapPartidoDetalhe(detalhe, 37906)).toEqual({
      partidoId: 37906,
      statusData: "2026-03-31T12:27",
      statusLegislaturaId: 57,
      situacao: "Ativo",
      totalPosse: 98,
      totalMembros: 98,
      uriMembros:
        "https://dadosabertos.camara.leg.br/api/v2/deputados?idLegislatura=57&siglaPartido=PL",
      lider: {
        uri: "https://dadosabertos.camara.leg.br/api/v2/deputados/204374",
        nome: "Bia Kicis",
        siglaPartido: "PL",
        uriPartido: "https://dadosabertos.camara.leg.br/api/v2/partidos/37906",
        uf: "DF",
        legislaturaId: 57,
        urlFoto:
          "https://www.camara.leg.br/internet/deputado/bandep/204374.jpg",
      },
      numeroEleitoral: null,
      urlLogo: "https://www.camara.leg.br/internet/Deputado/img/partidos/PL.gif",
      urlWebSite: null,
      urlFacebook: null,
    });
  });

  it("preserves a missing status and leadership as null data", () => {
    expect(
      mapPartidoDetalhe(
        {
          ...detalhe,
          status: null,
        },
        detalhe.id,
      ),
    ).toMatchObject({
      statusLegislaturaId: null,
      situacao: null,
      lider: {
        uri: null,
        nome: null,
      },
    });
  });

  it("rejects a response for a different party and invalid counts", () => {
    expect(() => mapPartidoDetalhe(detalhe, 123)).toThrow(
      "não corresponde ao partido 123",
    );
    expect(() =>
      mapPartidoDetalhe(
        {
          ...detalhe,
          status: { ...detalhe.status!, totalMembros: "98.5" },
        },
        detalhe.id,
      ),
    ).toThrow("status.totalMembros contém um inteiro inválido");
  });
});
