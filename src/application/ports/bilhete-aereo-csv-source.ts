import type { BilheteAereoCsv } from "@/domain/model/despesa";

export interface BilheteAereoCsvSource {
  read(
    filePath: string,
    onRecordRead?: (scanned: number) => void,
  ): AsyncIterable<BilheteAereoCsv>;
}
