import type { Page } from "./page";

export interface PartidoDto {
  readonly id: number;
  readonly sigla: string;
  readonly nome: string;
  readonly uri: string;
}

export interface ListPartidosQuery {
  readonly idLegislatura: number;
  readonly pagina: number;
}

export interface PartidoGateway {
  listPartidos(query: ListPartidosQuery): Promise<Page<PartidoDto>>;
}
