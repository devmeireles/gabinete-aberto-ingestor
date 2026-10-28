import { basename } from "node:path";
import { Readable } from "node:stream";
import type {
  BilheteAereoCsvArchive,
  BilheteAereoCsvArchiveSource,
} from "@/application/ports/bilhete-aereo-csv-archive-source";
import { currentDateInBrazil } from "@/shared/date";
import { Parse, type Entry } from "unzipper";

const FIRST_YEAR: number = 2008;
const CAMARA_CSV_URL: string = "https://www.camara.leg.br/cotas";
const DOWNLOAD_TIMEOUT_MS: number = 30 * 60 * 1000;

function extractCsv(
  zipStream: Readable,
  expectedFileName: string,
): AsyncIterable<Uint8Array> {
  return (async function* (): AsyncGenerator<Uint8Array> {
    const archive = zipStream.pipe(Parse({ forceStream: true }));
    zipStream.on("error", (error: Error) => archive.destroy(error));
    let csvFound: boolean = false;

    try {
      for await (const entry of archive as AsyncIterable<Entry>) {
        const isCsv: boolean =
          entry.type === "File" &&
          basename(entry.path).toLocaleLowerCase("en-US") ===
            expectedFileName.toLocaleLowerCase("en-US");

        if (!isCsv) {
          await entry.autodrain().promise();
          continue;
        }
        if (csvFound) {
          await entry.autodrain().promise();
          throw new Error(
            `O ZIP contém mais de um arquivo ${expectedFileName}`,
          );
        }

        csvFound = true;
        for await (const chunk of entry) {
          yield chunk;
        }
      }

      if (!csvFound) {
        throw new Error(`O ZIP não contém ${expectedFileName}`);
      }
    } catch (error: unknown) {
      const failure: Error =
        error instanceof Error ? error : new Error(String(error));
      zipStream.destroy(failure);
      archive.destroy(failure);
      throw failure;
    }
  })();
}

export class HttpBilheteAereoCsvArchiveSource implements BilheteAereoCsvArchiveSource {
  async openCsv(year: number): Promise<BilheteAereoCsvArchive> {
    const currentYear: number = Number(currentDateInBrazil().slice(0, 4));
    if (!Number.isInteger(year) || year < FIRST_YEAR || year > currentYear) {
      throw new Error(
        `Ano do CSV deve estar entre ${FIRST_YEAR} e ${currentYear}: ${year}`,
      );
    }

    const fileName: string = `Ano-${year}.csv`;
    const url: string = `${CAMARA_CSV_URL}/${fileName}.zip`;
    const response: Response = await fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Falha ao baixar CSV da Câmara para ${year}: HTTP ${response.status}`,
      );
    }
    if (response.body === null) {
      throw new Error(`Resposta vazia ao baixar o CSV da Câmara para ${year}`);
    }

    const zipStream: Readable = Readable.from(response.body);
    return {
      fileName,
      content: extractCsv(zipStream, fileName),
    };
  }
}
