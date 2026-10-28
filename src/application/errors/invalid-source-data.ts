/** Dado da API fora do esperado: não deve ser gravado, deve alertar. */
export class InvalidSourceDataError extends Error {
  constructor(detail: string) {
    super(`Dado inválido vindo da API: ${detail}`);
    this.name = "InvalidSourceDataError";
  }
}
