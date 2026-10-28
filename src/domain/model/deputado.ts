/** Dados estáveis do deputado, independentes de uma legislatura. */
export interface Deputado {
  readonly id: number;
  readonly nome: string;
  readonly uri: string;
  readonly urlFoto: string | null;
}

/** Dados do deputado que podem variar conforme a legislatura. */
export interface DeputadoLegislatura {
  readonly deputadoId: number;
  readonly legislaturaId: number;
  readonly siglaUf: string | null;
  readonly email: string | null;
}

/** Período em que o deputado esteve vinculado a um partido na legislatura. */
export interface DeputadoPartidoVigencia {
  readonly deputadoId: number;
  readonly legislaturaId: number;
  readonly partidoId: number | null;
  readonly dataInicio: string;
  readonly dataFim: string | null;
}
