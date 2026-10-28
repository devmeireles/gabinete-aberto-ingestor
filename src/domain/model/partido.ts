/** Dados de referência do partido identificados pela API da Câmara. */
export interface Partido {
  readonly id: number;
  readonly sigla: string;
  readonly nome: string;
  readonly uri: string;
}

/** Existência do partido no contexto temporal de uma legislatura. */
export interface PartidoLegislatura {
  readonly partidoId: number;
  readonly legislaturaId: number;
}
