import { NonRetriableError } from "inngest";
import { DuplicateExpenseNaturalKeyError } from "@/application/errors/duplicate-expense-natural-key-error";
import type {
  CrawlerRunRepository,
  CrawlerRunStart,
} from "@/application/ports/crawler-run-repository";

export interface InngestRunContext {
  readonly runId: string;
  readonly attempt: number;
  readonly eventName: string;
}

export async function runTrackedCrawler<TSummary extends object>(
  repository: CrawlerRunRepository,
  functionId: string,
  context: InngestRunContext,
  execute: () => Promise<TSummary>,
): Promise<TSummary> {
  const start: CrawlerRunStart = {
    functionId,
    runId: context.runId,
    eventName: context.eventName,
    attempt: context.attempt + 1,
  };
  await repository.start(start);

  try {
    const summary: TSummary = await execute();
    const serializableSummary: Record<string, unknown> = Object.fromEntries(
      Object.entries(summary),
    );
    await repository.complete(functionId, context.runId, serializableSummary);
    return summary;
  } catch (error: unknown) {
    const message: string =
      error instanceof Error ? error.message : String(error);
    try {
      await repository.fail(functionId, context.runId, message);
    } catch (recordingError: unknown) {
      throw new AggregateError(
        [error, recordingError],
        `Crawler ${functionId} falhou e não foi possível registrar a falha`,
        { cause: recordingError },
      );
    }
    if (error instanceof DuplicateExpenseNaturalKeyError) {
      throw new NonRetriableError(message, { cause: error });
    }
    throw error;
  }
}
