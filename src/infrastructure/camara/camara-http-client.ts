import { setTimeout as sleep } from "node:timers/promises";
import { CamaraContractError, CamaraHttpError } from "./camara-errors";
import type { RequestScheduler } from "./request-scheduler";

export interface Link {
  readonly href: string;
  readonly rel: string;
}

/** Envelope padrão da API: { dados, links }. */
export interface Envelope<T> {
  readonly dados: T;
  readonly links: readonly Link[];
}

export type QueryParams = Readonly<Record<string, string | number>>;

export interface CamaraResponse<T> {
  readonly envelope: Envelope<T>;
  /** Caminho + query ordenada: a mesma requisição lógica gera sempre a mesma chave. */
  readonly requestKey: string;
}

export interface CamaraHttpClientOptions {
  readonly baseUrl: string;
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly timeoutMs: number;
}

export const DEFAULT_OPTIONS: CamaraHttpClientOptions = {
  baseUrl: "https://dadosabertos.camara.leg.br/api/v2/",
  maxRetries: 5,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  timeoutMs: 20_000,
};

export class CamaraHttpClient {
  constructor(
    private readonly scheduler: RequestScheduler,
    private readonly options: CamaraHttpClientOptions = DEFAULT_OPTIONS,
  ) {}

  async getJson<T>(
    path: string,
    query: QueryParams = {},
  ): Promise<CamaraResponse<T>> {
    const url: URL = this.buildUrl(path, query);
    let attempt: number = 0;

    for (;;) {
      try {
        return await this.scheduler.run(() => this.fetchOnce<T>(url));
      } catch (error: unknown) {
        if (!this.isRetryable(error) || attempt >= this.options.maxRetries) {
          throw error;
        }
        const delayMs: number = this.computeDelayMs(attempt, error);
        attempt++;
        // O sleep fica FORA do scheduler: esperar o backoff não pode ocupar
        // um slot de concorrência que outra requisição poderia usar.
        await sleep(delayMs);
      }
    }
  }

  private buildUrl(path: string, query: QueryParams): URL {
    // path sem "/" inicial, para o baseUrl (com "/api/v2/") ser preservado.
    const url: URL = new URL(path.replace(/^\//, ""), this.options.baseUrl);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
    return url;
  }

  private toRequestKey(url: URL): string {
    const sorted: Array<[string, string]> = [
      ...url.searchParams.entries(),
    ].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const queryString: string = new URLSearchParams(sorted).toString();
    return queryString === "" ? url.pathname : `${url.pathname}?${queryString}`;
  }

  private async fetchOnce<T>(url: URL): Promise<CamaraResponse<T>> {
    const response: Response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });

    if (!response.ok) {
      throw new CamaraHttpError(
        response.status,
        url.toString(),
        this.parseRetryAfterMs(response.headers.get("retry-after")),
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new CamaraContractError(url.toString(), "corpo não é JSON válido");
    }
    return {
      envelope: this.assertEnvelope<T>(body, url.toString()),
      requestKey: this.toRequestKey(url),
    };
  }

  /**
   * Validação mínima do envelope. O spec avisa que a API é "incompleta e
   * sujeita a mudanças": falhar alto na borda é melhor que gravar lixo.
   * A validação campo a campo (zod) entra por endpoint no próximo passo.
   */
  private assertEnvelope<T>(body: unknown, url: string): Envelope<T> {
    if (typeof body !== "object" || body === null) {
      throw new CamaraContractError(url, "resposta não é um objeto");
    }
    const candidate: { dados?: unknown; links?: unknown } = body;
    if (candidate.dados === undefined) {
      throw new CamaraContractError(url, 'campo "dados" ausente');
    }
    if (!Array.isArray(candidate.links)) {
      throw new CamaraContractError(url, 'campo "links" ausente ou inválido');
    }
    return candidate as Envelope<T>;
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof CamaraHttpError) return error.isRetryable;
    if (error instanceof CamaraContractError) return false;
    return true; // erro de rede ou timeout: transitório
  }

  /**
   * "Full jitter": sorteia entre 0 e o teto exponencial. Por quê: se vários
   * steps falham juntos, backoff determinístico faz todos voltarem juntos
   * (thundering herd). O sorteio espalha as retentativas.
   * Se a API mandou Retry-After, ele é o piso.
   */
  private computeDelayMs(attempt: number, error: unknown): number {
    const ceiling: number = Math.min(
      this.options.maxDelayMs,
      this.options.baseDelayMs * 2 ** attempt,
    );
    const jittered: number = Math.random() * ceiling;
    const retryAfter: number =
      error instanceof CamaraHttpError ? (error.retryAfterMs ?? 0) : 0;
    return Math.max(jittered, retryAfter);
  }

  private parseRetryAfterMs(header: string | null): number | null {
    if (header === null) return null;
    const seconds: number = Number(header);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  }
}
