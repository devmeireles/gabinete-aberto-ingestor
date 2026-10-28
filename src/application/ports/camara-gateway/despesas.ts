import type { Page } from "./page";

export interface DespesaDto {
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

export interface ListDespesasQuery {
  readonly idDeputado: number;
  /** Obrigatórios: sem filtro de tempo a API devolve só os últimos 6 meses. */
  readonly ano: number;
  readonly mes: number;
  readonly pagina: number;
}

export interface DespesaGateway {
  listDespesas(query: ListDespesasQuery): Promise<Page<DespesaDto>>;
}
