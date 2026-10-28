import "dotenv/config";
import { ImportBilhetesAereosCsv } from "@/application/use-cases/import-bilhetes-aereos-csv";
import type { DespesaRepository } from "@/application/ports/despesa-repository";
import { StreamingBilheteAereoCsvSource } from "@/infrastructure/csv/streaming-bilhete-aereo-csv-source";
import {
  createDatabase,
  type DatabaseHandle,
} from "@/infrastructure/persistence/client";
import { DrizzleDespesaRepository } from "@/infrastructure/persistence/drizzle-despesa-repository";
import type { CsvImportProgress } from "@/application/use-cases/import-bilhetes-aereos-csv";

interface Options {
  readonly filePath: string;
  readonly persist: boolean;
}

export function parseBilhetesCsvOptions(args: readonly string[]): Options {
  let filePath: string | undefined;
  let persist: boolean = false;
  let modeWasSelected: boolean = false;

  for (let index: number = 0; index < args.length; index++) {
    const argument: string = args[index]!;
    if (argument === "--persist" || argument === "--dry-run") {
      if (modeWasSelected) {
        throw new Error("Escolha apenas um modo: --dry-run ou --persist");
      }
      persist = argument === "--persist";
      modeWasSelected = true;
      continue;
    }
    const separator: number = argument.indexOf("=");
    const option: string =
      separator < 0 ? argument : argument.slice(0, separator);
    if (option !== "--arquivo") {
      throw new Error(`Argumento desconhecido: ${argument}`);
    }
    const value: string | undefined =
      separator < 0 ? args[++index] : argument.slice(separator + 1);
    if (value === undefined || value.trim() === "") {
      throw new Error("Informe o caminho com --arquivo=<caminho>");
    }
    filePath = value;
  }

  if (filePath === undefined) {
    throw new Error("Informe --arquivo=<caminho>");
  }
  return { filePath, persist };
}

export async function runBilhetesCsv(args: readonly string[]): Promise<void> {
  const options: Options = parseBilhetesCsvOptions(args);
  const source = new StreamingBilheteAereoCsvSource();

  if (!options.persist) {
    const result = await new ImportBilhetesAereosCsv(source).preview(
      options.filePath,
      (progress) => {
        console.log(
          JSON.stringify({
            event: "crawler.bilhetes_csv.dry_run.progress",
            ...progress,
          }),
        );
      },
    );
    if (result.sample !== null) {
      console.log(
        JSON.stringify(
          {
            event: "crawler.bilhetes_csv.dry_run.sample",
            sample: result.sample,
          },
          null,
          2,
        ),
      );
    }
    console.log(
      JSON.stringify({
        event: "crawler.bilhetes_csv.dry_run.completed",
        scanned: result.scanned,
        candidates: result.candidates,
        writes: { postgres: false },
      }),
    );
    return;
  }

  const databaseUrl: string | undefined = process.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    throw new Error("DATABASE_URL é obrigatória para usar --persist");
  }
  const database: DatabaseHandle = createDatabase(databaseUrl);
  try {
    const repository: DespesaRepository = new DrizzleDespesaRepository(
      database.db,
    );
    const result = await new ImportBilhetesAereosCsv(
      source,
      repository,
    ).execute(options.filePath, (progress: CsvImportProgress) => {
      console.log(
        JSON.stringify({
          event: "crawler.bilhetes_csv.progress",
          ...progress,
        }),
      );
    });
    console.log(
      JSON.stringify({
        event: "crawler.bilhetes_csv.completed",
        ...result,
        writes: { postgres: true },
      }),
    );
  } finally {
    await database.pool.end();
  }
}
