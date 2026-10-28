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
  readonly siglaPartido: string | null;
  readonly partidoId: number | null;
  readonly siglaUf: string | null;
  readonly email: string | null;
}
