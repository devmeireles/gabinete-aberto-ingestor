import { describe, expect, it } from "vitest";
import { mapDeputadoDetalhe } from "@/application/mappers/deputado-detalhe-mapper";
import type { DeputadoDetalheDto } from "@/application/ports/camara-gateway/deputados";

const detalhe: DeputadoDetalheDto = {
  id: 218086,
  uri: "https://dadosabertos.camara.leg.br/api/v2/deputados/218086",
  nomeCivil: "ELIANE DE SOUSA ALVES",
  ultimoStatus: {
    id: 218086,
    uri: "https://dadosabertos.camara.leg.br/api/v2/deputados/218086",
    nome: "Ely Santos",
    siglaPartido: "REPUBLICANOS",
    uriPartido: null,
    siglaUf: "SP",
    idLegislatura: 57,
    urlFoto: "https://www.camara.leg.br/internet/deputado/bandep/218086.jpg",
    email: null,
    data: "2026-03-31",
    nomeEleitoral: "Ely Santos",
    gabinete: {
      nome: null,
      predio: null,
      sala: null,
      andar: null,
      telefone: null,
      email: null,
    },
    situacao: "Suplência",
    condicaoEleitoral: "Suplente",
    descricaoStatus: null,
  },
  cpf: "16810770860",
  sexo: "F",
  urlWebsite: null,
  redeSocial: ["https://instagram.com/deputadafederal_elysantos"],
  dataNascimento: "1977-01-13",
  dataFalecimento: null,
  ufNascimento: "SP",
  municipioNascimento: "São Paulo",
  escolaridade: "Ensino Médio",
};

describe("mapDeputadoDetalhe", () => {
  it("maps personal data and the latest status independently", () => {
    expect(mapDeputadoDetalhe(detalhe, 218086)).toMatchObject({
      deputadoId: 218086,
      nomeCivil: "ELIANE DE SOUSA ALVES",
      dataNascimento: "1977-01-13",
      statusLegislaturaId: 57,
      statusNome: "Ely Santos",
      statusUri: "https://dadosabertos.camara.leg.br/api/v2/deputados/218086",
      nomeEleitoral: "Ely Santos",
      siglaPartido: "REPUBLICANOS",
      gabinete: {
        nome: null,
        telefone: null,
      },
    });
  });

  it("rejects a detail response for a different deputy", () => {
    expect(() => mapDeputadoDetalhe(detalhe, 99)).toThrow(
      "não corresponde ao deputado 99",
    );
  });

  it("rejects malformed source dates", () => {
    expect(() =>
      mapDeputadoDetalhe(
        { ...detalhe, dataNascimento: "13/01/1977" },
        detalhe.id,
      ),
    ).toThrow("dataNascimento contém uma data inválida");
  });
});
