export interface Despesa {
  readonly deputadoId: number;
  readonly legislaturaId: number;
  readonly ano: number;
  readonly mes: number;
  readonly tipoDespesa: string;
  readonly codDocumento: string;
  readonly tipoDocumento: string;
  readonly codTipoDocumento: number;
  readonly dataDocumento: string | null;
  readonly numDocumento: string;
  readonly parcela: number;
  readonly numRessarcimento: string;
  readonly codLote: number;
  readonly nomeFornecedor: string;
  readonly cnpjCpfFornecedor: string;
  readonly valorDocumento: number;
  readonly valorGlosa: number;
  readonly valorLiquido: number;
  readonly urlDocumento: string | null;
}

export interface BilheteAereoCsv {
  readonly deputadoId: number;
  readonly legislaturaId: number;
  readonly ano: number;
  readonly mes: number;
  readonly tipoDespesa: string;
  readonly codTipoDocumento: number;
  readonly codDocumento: string;
  readonly dataDocumento: string;
  readonly numDocumento: string;
  readonly parcela: number;
  readonly codLote: number;
  readonly cnpjCpfFornecedor: string;
  readonly valorDocumento: number;
  readonly passageiro: string;
  readonly trecho: string;
  readonly arquivo: string;
  readonly linha: number;
}
