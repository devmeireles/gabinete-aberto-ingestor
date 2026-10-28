/** Dados estáveis do deputado, independentes de uma legislatura. */
export interface Deputado {
  readonly id: number;
  readonly nome: string;
  readonly uri: string;
  readonly urlFoto: string | null;
}

export interface DeputadoGabinete {
  readonly nome: string | null;
  readonly predio: string | null;
  readonly sala: string | null;
  readonly andar: string | null;
  readonly telefone: string | null;
  readonly email: string | null;
}

export interface DeputadoDetalhe {
  readonly deputadoId: number;
  readonly nomeCivil: string | null;
  readonly cpf: string | null;
  readonly sexo: string | null;
  readonly urlWebsite: string | null;
  readonly redesSociais: readonly string[];
  readonly dataNascimento: string | null;
  readonly dataFalecimento: string | null;
  readonly ufNascimento: string | null;
  readonly municipioNascimento: string | null;
  readonly escolaridade: string | null;
  readonly statusLegislaturaId: number;
  readonly statusNome: string | null;
  readonly statusUri: string;
  readonly nomeEleitoral: string | null;
  readonly siglaPartido: string | null;
  readonly uriPartido: string | null;
  readonly siglaUf: string | null;
  readonly urlFoto: string | null;
  readonly email: string | null;
  readonly dataStatus: string | null;
  readonly situacao: string | null;
  readonly condicaoEleitoral: string | null;
  readonly descricaoStatus: string | null;
  readonly gabinete: DeputadoGabinete;
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
