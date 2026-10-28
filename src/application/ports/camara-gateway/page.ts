export interface Page<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly hasNext: boolean;
  /** Chave canônica da requisição que produziu este payload. */
  readonly requestKey: string;
  readonly rawBody: unknown;
}
