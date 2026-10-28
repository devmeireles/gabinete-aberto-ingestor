import type {
  CsvEnrichmentResult,
  DespesaRepository,
} from "@/application/ports/despesa-repository";
import type { BilheteAereoCsvSource } from "@/application/ports/bilhete-aereo-csv-source";
import type { BilheteAereoCsv } from "@/domain/model/despesa";

const BATCH_SIZE: number = 250;

export interface ImportBilhetesCsvResult extends CsvEnrichmentResult {
  readonly scanned: number;
  readonly candidates: number;
}

export interface CsvImportProgress {
  readonly scanned: number;
  readonly candidates: number;
  readonly imported: number;
}

export interface CsvDryRunResult {
  readonly scanned: number;
  readonly candidates: number;
  readonly sample: BilheteAereoCsv | null;
}

export class ImportBilhetesAereosCsv {
  constructor(
    private readonly source: BilheteAereoCsvSource,
    private readonly repository?: DespesaRepository,
  ) {}

  async execute(
    filePath: string,
    onProgress?: (progress: CsvImportProgress) => void,
  ): Promise<ImportBilhetesCsvResult> {
    const result = await this.importCandidates(
      (onRecordRead) => this.readCandidates(filePath, onRecordRead),
      onProgress,
    );
    const enrichment = await this.reconcile();
    return { ...result, ...enrichment };
  }

  async importStream(
    fileName: string,
    content: AsyncIterable<Uint8Array>,
    onProgress?: (progress: CsvImportProgress) => void,
  ): Promise<ImportBilhetesCsvResult> {
    const result = await this.importCandidates(
      (onRecordRead) => this.source.readStream(fileName, content, onRecordRead),
      onProgress,
    );
    return { ...result, enriched: 0, ambiguous: 0 };
  }

  async reconcile(
    year?: number,
  ): Promise<Omit<CsvEnrichmentResult, "imported">> {
    if (this.repository === undefined) {
      throw new Error(
        "O repositório é obrigatório para importar com persistência",
      );
    }
    return this.repository.enrichFromBilhetesCsv(year);
  }

  private async importCandidates(
    createCandidates: (
      onRecordRead: (scanned: number) => void,
    ) => AsyncIterable<BilheteAereoCsv>,
    onProgress?: (progress: CsvImportProgress) => void,
  ): Promise<
    Pick<ImportBilhetesCsvResult, "scanned" | "candidates" | "imported">
  > {
    if (this.repository === undefined) {
      throw new Error(
        "O repositório é obrigatório para importar com persistência",
      );
    }
    let scanned: number = 0;
    let candidates: number = 0;
    let imported: number = 0;
    let batch: BilheteAereoCsv[] = [];

    for await (const candidate of createCandidates((count) => {
      scanned = count;
      if (scanned % 20_000 === 0) {
        onProgress?.({ scanned, candidates, imported });
      }
    })) {
      candidates++;
      batch.push(candidate);
      if (batch.length >= BATCH_SIZE) {
        imported += (await this.repository.importBilhetesCsv(batch)).imported;
        batch = [];
      }
    }

    if (batch.length > 0) {
      imported += (await this.repository.importBilhetesCsv(batch)).imported;
    }
    return { scanned, candidates, imported };
  }

  async preview(
    filePath: string,
    onProgress?: (progress: Omit<CsvImportProgress, "imported">) => void,
  ): Promise<CsvDryRunResult> {
    let scanned: number = 0;
    let candidates: number = 0;
    let sample: BilheteAereoCsv | null = null;
    for await (const candidate of this.readCandidates(filePath, (count) => {
      scanned = count;
      if (scanned % 20_000 === 0) onProgress?.({ scanned, candidates });
    })) {
      candidates++;
      sample ??= candidate;
    }
    return { scanned, candidates, sample };
  }

  private readCandidates(
    filePath: string,
    onRecordRead: (scanned: number) => void,
  ): AsyncIterable<BilheteAereoCsv> {
    return this.source.read(filePath, onRecordRead);
  }
}
