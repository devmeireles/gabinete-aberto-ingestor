export interface CamaraEnv {
  /** Teto de requisições simultâneas desta instância à API da Câmara. */
  readonly camaraMaxConcurrent: number;
  /** Espaçamento mínimo entre inícios de requisição, em ms. */
  readonly camaraMinIntervalMs: number;
}

export interface Env extends CamaraEnv {
  readonly port: number;
  readonly databaseUrl: string;
}

function requireString(source: NodeJS.ProcessEnv, key: string): string {
  const value: string | undefined = source[key];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Variável de ambiente obrigatória ausente: ${key}`);
  }
  return value;
}

function readInt(
  source: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const raw: string | undefined = source[key];
  if (raw === undefined || raw === "") return fallback;
  const parsed: number = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `Variável ${key} deve ser um inteiro >= 0, recebido: ${raw}`,
    );
  }
  return parsed;
}

/**
 * Falha rápido no boot se a configuração está errada. Por quê: descobrir
 * "faltou a signing key" só quando o Inngest chama o endpoint é pior que o
 * container nem subir (o Cloud Run mostra a revisão como falha).
 *
 * As chaves do Inngest são obrigatórias em produção: a aplicação recebe
 * chamadas autenticadas e publica eventos entre as etapas dos seeds.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (source["NODE_ENV"] === "production") {
    requireString(source, "INNGEST_SIGNING_KEY");
    requireString(source, "INNGEST_EVENT_KEY");
  }
  return {
    // O Cloud Run injeta PORT (8080).
    port: readInt(source, "PORT", 8080),
    databaseUrl: requireString(source, "DATABASE_URL"),
    ...loadCamaraEnv(source),
  };
}

export function loadCamaraEnv(
  source: NodeJS.ProcessEnv = process.env,
): CamaraEnv {
  const camaraMaxConcurrent: number = readInt(
    source,
    "CAMARA_MAX_CONCURRENT",
    2,
  );
  if (camaraMaxConcurrent === 0) {
    throw new Error("Variável CAMARA_MAX_CONCURRENT deve ser maior que 0");
  }
  return {
    camaraMaxConcurrent,
    camaraMinIntervalMs: readInt(source, "CAMARA_MIN_INTERVAL_MS", 250),
  };
}
