import { setTimeout as sleep } from "node:timers/promises";

/**
 * Controla a pressão que ESTA instância exerce sobre a API:
 *  - maxConcurrent: quantas requisições em voo ao mesmo tempo;
 *  - minIntervalMs: espaçamento mínimo entre o INÍCIO de duas requisições.
 *
 * Por quê dois controles: concorrência limita picos; intervalo suaviza a taxa.
 *
 * Limite honesto: no Cloud Run podem existir várias instâncias, e este
 * scheduler é por processo. O controle GLOBAL vem do `concurrency`/`throttle`
 * das funções Inngest. Este aqui é o cinto de segurança local.
 */
export class RequestScheduler {
  private active: number = 0;
  private nextStartAt: number = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly minIntervalMs: number,
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
    } else {
      // O slot é transferido por release(), então `active` não muda aqui.
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }

    // Reserva síncrona do horário de início: sem race entre chamadas
    // concorrentes, já que o Node é single-thread entre awaits.
    const now: number = Date.now();
    const startAt: number = Math.max(now, this.nextStartAt);
    this.nextStartAt = startAt + this.minIntervalMs;
    if (startAt > now) {
      await sleep(startAt - now);
    }
  }

  private release(): void {
    const next: (() => void) | undefined = this.waiters.shift();
    if (next !== undefined) {
      next();
    } else {
      this.active--;
    }
  }
}
