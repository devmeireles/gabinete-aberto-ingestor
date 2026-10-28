import type { BilheteAereoCsv } from "@/domain/model/despesa";

export interface BilheteAereoCsvSource {
  read(
    filePath: string,
    onRecordRead?: (scanned: number) => void,
  ): AsyncIterable<BilheteAereoCsv>;
  readStream(
    fileName: string,
    content: AsyncIterable<Uint8Array>,
    onRecordRead?: (scanned: number) => void,
  ): AsyncIterable<BilheteAereoCsv>;
}
