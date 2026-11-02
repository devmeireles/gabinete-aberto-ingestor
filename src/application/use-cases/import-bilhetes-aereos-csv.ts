import type {
  CsvEnrichmentResult,
  DespesaRepository,
} from "@/application/ports/despesa-repository";
import type {
  BilheteAereoCsvSource,
  CsvSkippedRecord,
} from "@/application/ports/bilhete-aereo-csv-source";
import type { BilheteAereoCsv } from "@/domain/model/despesa";

const BATCH_SIZE: number = 250;

export interface ImportBilhetesCsvResult extends CsvEnrichmentResult {
  readonly scanned: number;
  readonly candidates: number;
  readonly skipped: number;
  readonly skippedSamples: readonly CsvSkippedRecord[];
}

export interface CsvImportProgress {
  readonly scanned: number;
  readonly candidates: number;
  readonly imported: number;
  readonly skipped: number;
}

export interface CsvDryRunResult {
  readonly scanned: number;
  readonly candidates: number;
  readonly skipped: number;
  readonly skippedSamples: readonly CsvSkippedRecord[];
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
      (onRecordRead, onRecordSkipped) =>
        this.readCandidates(filePath, onRecordRead, onRecordSkipped),
      onProgress,
    );
    const enrichment = await this.reconcile();
    return {
      ...result,
      ...enrichment,
      removed: result.removed + enrichment.removed,
    };
  }

  async importStream(
    fileName: string,
    content: AsyncIterable<Uint8Array>,
    onProgress?: (progress: CsvImportProgress) => void,
  ): Promise<ImportBilhetesCsvResult> {
    const result = await this.importCandidates(
      (onRecordRead, onRecordSkipped) =>
        this.source.readStream(
          fileName,
          content,
          onRecordRead,
          onRecordSkipped,
        ),
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
      onRecordSkipped: (record: CsvSkippedRecord) => void,
    ) => AsyncIterable<BilheteAereoCsv>,
    onProgress?: (progress: CsvImportProgress) => void,
  ): Promise<
    Pick<
      ImportBilhetesCsvResult,
      | "scanned"
      | "candidates"
      | "imported"
      | "removed"
      | "skipped"
      | "skippedSamples"
    >
  > {
    if (this.repository === undefined) {
      throw new Error(
        "O repositório é obrigatório para importar com persistência",
      );
    }
    let scanned: number = 0;
    let candidates: number = 0;
    let imported: number = 0;
    let removed = 0;
    let skipped = 0;
    const skippedSamples: CsvSkippedRecord[] = [];
    let batch: BilheteAereoCsv[] = [];

    for await (const candidate of createCandidates(
      (count) => {
        scanned = count;
        if (scanned % 20_000 === 0) {
          onProgress?.({ scanned, candidates, imported, skipped });
        }
      },
      (record) => {
        skipped++;
        if (skippedSamples.length < 10) skippedSamples.push(record);
      },
    )) {
      candidates++;
      batch.push(candidate);
      if (batch.length >= BATCH_SIZE) {
        const result = await this.repository.importBilhetesCsv(batch);
        imported += result.imported;
        removed += result.removed;
        batch = [];
      }
    }

    if (batch.length > 0) {
      const result = await this.repository.importBilhetesCsv(batch);
      imported += result.imported;
      removed += result.removed;
    }
    return { scanned, candidates, imported, removed, skipped, skippedSamples };
  }

  async preview(
    filePath: string,
    onProgress?: (progress: Omit<CsvImportProgress, "imported">) => void,
  ): Promise<CsvDryRunResult> {
    let scanned: number = 0;
    let candidates: number = 0;
    let skipped: number = 0;
    const skippedSamples: CsvSkippedRecord[] = [];
    let sample: BilheteAereoCsv | null = null;
    for await (const candidate of this.readCandidates(
      filePath,
      (count) => {
        scanned = count;
        if (scanned % 20_000 === 0) {
          onProgress?.({ scanned, candidates, skipped });
        }
      },
      (record) => {
        skipped++;
        if (skippedSamples.length < 10) skippedSamples.push(record);
      },
    )) {
      candidates++;
      sample ??= candidate;
    }
    return { scanned, candidates, skipped, skippedSamples, sample };
  }

  private readCandidates(
    filePath: string,
    onRecordRead: (scanned: number) => void,
    onRecordSkipped: (record: CsvSkippedRecord) => void,
  ): AsyncIterable<BilheteAereoCsv> {
    return this.source.read(filePath, onRecordRead, onRecordSkipped);
  }
}
