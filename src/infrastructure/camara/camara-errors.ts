/**
 * Erros tipados do cliente HTTP.
 *
 * Por quê: o retry precisa distinguir falha TRANSITÓRIA (429, 5xx, rede)
 * de falha DEFINITIVA (400, 404, contrato quebrado). Retentar o que nunca vai
 * funcionar só gasta cota da API e atrasa o alerta.
 */

export class CamaraHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly retryAfterMs: number | null,
  ) {
    super(`Camara API respondeu HTTP ${status} para ${url}`);
    this.name = "CamaraHttpError";
  }

  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/** A resposta não tem o formato esperado: provável mudança de contrato. */
export class CamaraContractError extends Error {
  constructor(
    readonly url: string,
    detail: string,
  ) {
    super(`Contrato inesperado em ${url}: ${detail}`);
    this.name = "CamaraContractError";
  }
}
