import type { Page } from "./page";

export interface PartidoDto {
  readonly id: number;
  readonly sigla: string;
  readonly nome: string;
  readonly uri: string;
}

export interface PartidoLiderDto {
  readonly uri: string | null;
  readonly nome: string | null;
  readonly siglaPartido: string | null;
  readonly uriPartido: string | null;
  readonly uf: string | null;
  readonly idLegislatura: number | null;
  readonly urlFoto: string | null;
}

export interface PartidoDetalheDto extends PartidoDto {
  readonly status: {
    readonly data: string | null;
    readonly idLegislatura: number | string | null;
    readonly situacao: string | null;
    readonly totalPosse: number | string | null;
    readonly totalMembros: number | string | null;
    readonly uriMembros: string | null;
    readonly lider: PartidoLiderDto | null;
  } | null;
  readonly numeroEleitoral: number | string | null;
  readonly urlLogo: string | null;
  readonly urlWebSite: string | null;
  readonly urlFacebook: string | null;
}

export interface ListPartidosQuery {
  readonly idLegislatura: number;
  readonly pagina: number;
}

export interface PartidoGateway {
  listPartidos(query: ListPartidosQuery): Promise<Page<PartidoDto>>;
  getPartido(partidoId: number): Promise<{
    readonly item: PartidoDetalheDto;
    readonly requestKey: string;
    readonly rawBody: unknown;
  }>;
}
