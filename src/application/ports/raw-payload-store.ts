/**
 * PORTA da camada raw.
 *
 * Idempotente: salvar o mesmo corpo para a mesma requisição não cria nova
 * linha, só marca que ele foi visto de novo. Devolve o id para que as linhas
 * normalizadas apontem para a resposta que as originou.
 */
export interface RawPayloadStore {
  save(requestKey: string, body: unknown): Promise<number>;
}
