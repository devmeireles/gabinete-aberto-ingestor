import { NonRetriableError } from "inngest";
import { DuplicateExpenseNaturalKeyError } from "@/application/errors/duplicate-expense-natural-key-error";
import type { CrawlerRunRepository } from "@/application/ports/crawler-run-repository";
import {
  runTrackedCrawler as trackCrawler,
  type CrawlerRunContext,
} from "@/application/use-cases/run-tracked-crawler";

export type InngestRunContext = CrawlerRunContext;

export async function runTrackedCrawler<TSummary extends object>(
  repository: CrawlerRunRepository,
  functionId: string,
  context: InngestRunContext,
  execute: () => Promise<TSummary>,
): Promise<TSummary> {
  try {
    return await trackCrawler(repository, functionId, context, execute);
  } catch (error: unknown) {
    if (error instanceof DuplicateExpenseNaturalKeyError) {
      throw new NonRetriableError(error.message, { cause: error });
    }
    throw error;
  }
}
