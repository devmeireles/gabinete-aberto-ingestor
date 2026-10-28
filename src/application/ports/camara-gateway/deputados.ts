import type { Page } from "./page";

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

export interface DeputadoGateway {
  listDeputados(query: ListDeputadosQuery): Promise<Page<DeputadoDto>>;
}
