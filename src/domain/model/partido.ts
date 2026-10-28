/** Dados de referência do partido identificados pela API da Câmara. */
export interface Partido {
  readonly id: number;
  readonly sigla: string;
  readonly nome: string;
  readonly uri: string;
}

export interface PartidoLider {
  readonly uri: string | null;
  readonly nome: string | null;
  readonly siglaPartido: string | null;
  readonly uriPartido: string | null;
  readonly uf: string | null;
  readonly legislaturaId: number | null;
  readonly urlFoto: string | null;
}

export interface PartidoDetalhe {
  readonly partidoId: number;
  readonly statusData: string | null;
  readonly statusLegislaturaId: number | null;
  readonly situacao: string | null;
  readonly totalPosse: number | null;
  readonly totalMembros: number | null;
  readonly uriMembros: string | null;
  readonly lider: PartidoLider;
  readonly numeroEleitoral: string | null;
  readonly urlLogo: string | null;
  readonly urlWebSite: string | null;
  readonly urlFacebook: string | null;
}

/** Existência do partido no contexto temporal de uma legislatura. */
export interface PartidoLegislatura {
  readonly partidoId: number;
  readonly legislaturaId: number;
}
