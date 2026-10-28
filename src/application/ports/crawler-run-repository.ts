export interface CrawlerRunStart {
  readonly functionId: string;
  readonly runId: string;
  readonly eventName: string;
  readonly attempt: number;
}

export interface CrawlerRunRepository {
  start(input: CrawlerRunStart): Promise<void>;
  complete(
    functionId: string,
    runId: string,
    summary: Readonly<Record<string, unknown>>,
  ): Promise<void>;
  fail(functionId: string, runId: string, error: string): Promise<void>;
}
