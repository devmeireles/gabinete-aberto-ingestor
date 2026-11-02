import type { BilheteAereoCsv } from "@/domain/model/despesa";

export interface CsvSkippedRecord {
  readonly line: number;
  readonly reason: string;
}

export interface BilheteAereoCsvSource {
  read(
    filePath: string,
    onRecordRead?: (scanned: number) => void,
    onRecordSkipped?: (record: CsvSkippedRecord) => void,
  ): AsyncIterable<BilheteAereoCsv>;
  readStream(
    fileName: string,
    content: AsyncIterable<Uint8Array>,
    onRecordRead?: (scanned: number) => void,
    onRecordSkipped?: (record: CsvSkippedRecord) => void,
  ): AsyncIterable<BilheteAereoCsv>;
}
