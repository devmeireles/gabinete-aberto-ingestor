import { Inngest } from "inngest";

const eventKey: string | undefined = process.env["INNGEST_EVENT_KEY"];

/** Cliente único do Inngest, incluindo a chave para publicar eventos. */
export const inngest: Inngest = new Inngest({
  id: "gabinete-aberto-ingestor",
  ...(eventKey === undefined || eventKey.trim() === "" ? {} : { eventKey }),
});

/**
 * Orçamento GLOBAL de requisições à API da Câmara.
 *
 * Por quê: `concurrency` no Inngest limita STEPS em execução simultânea. Com
 * a mesma `key` e scope "env", todas as funções compartilham este teto, então
 * duas sincronizações rodando juntas não somam pressão sobre a API.
 * (`throttle`, ao contrário, limita o INÍCIO de runs, não os steps.)
 */
export const CAMARA_API_CONCURRENCY: {
  readonly limit: number;
  readonly key: string;
  readonly scope: "env";
} = {
  limit: 2,
  key: '"camara-api"',
  scope: "env",
};
