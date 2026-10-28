import type { Page } from "./page";

export interface DeputadoStatusDto {
  readonly id: number;
  readonly uri: string;
  readonly nome: string | null;
  readonly siglaPartido: string | null;
  readonly uriPartido: string | null;
  readonly siglaUf: string | null;
  readonly idLegislatura: number;
  readonly urlFoto: string | null;
  readonly email: string | null;
  readonly data: string | null;
  readonly nomeEleitoral: string | null;
  readonly gabinete: {
    readonly nome: string | null;
    readonly predio: string | null;
    readonly sala: string | null;
    readonly andar: string | null;
    readonly telefone: string | null;
    readonly email: string | null;
  } | null;
  readonly situacao: string | null;
  readonly condicaoEleitoral: string | null;
  readonly descricaoStatus: string | null;
}

export interface DeputadoDetalheDto {
  readonly id: number;
  readonly uri: string;
  readonly nomeCivil: string | null;
  readonly ultimoStatus: DeputadoStatusDto;
  readonly cpf: string | null;
  readonly sexo: string | null;
  readonly urlWebsite: string | null;
  readonly redeSocial: readonly string[];
  readonly dataNascimento: string | null;
  readonly dataFalecimento: string | null;
  readonly ufNascimento: string | null;
  readonly municipioNascimento: string | null;
  readonly escolaridade: string | null;
}

export interface Resource<T> {
  readonly item: T;
  readonly requestKey: string;
  readonly rawBody: unknown;
}

export interface DeputadoDto {
  readonly id: number;
  readonly idLegislatura: number;
  readonly nome: string;
  readonly siglaPartido: string;
  readonly siglaUf: string;
  readonly uri: string;
  readonly uriPartido: string;
  readonly urlFoto: string;
  readonly email: string | null;
}

export interface ListDeputadosQuery {
  readonly idLegislatura: number;
  readonly pagina: number;
}

export interface DeputadoHistoricoDto {
  readonly id: number;
  readonly idLegislatura: number;
  readonly siglaPartido: string | null;
  readonly uriPartido: string | null;
  readonly dataHora: string;
}

export interface DeputadoGateway {
  listDeputados(query: ListDeputadosQuery): Promise<Page<DeputadoDto>>;
  getDeputado(deputadoId: number): Promise<Resource<DeputadoDetalheDto>>;
  getDeputadoHistorico(deputadoId: number): Promise<Page<DeputadoHistoricoDto>>;
}
