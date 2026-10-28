/** Entidade de domínio: sem HTTP, sem banco, sem formato da API. */
export interface Legislatura {
  readonly id: number;
  readonly uri: string;
  /** Formato AAAA-MM-DD. */
  readonly dataInicio: string;
  /** Null enquanto a legislatura não tem data de término registrada. */
  readonly dataFim: string | null;
}
