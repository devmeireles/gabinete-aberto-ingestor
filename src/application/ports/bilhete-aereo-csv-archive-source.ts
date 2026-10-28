export interface BilheteAereoCsvArchive {
  readonly fileName: string;
  readonly content: AsyncIterable<Uint8Array>;
}

export interface BilheteAereoCsvArchiveSource {
  openCsv(year: number): Promise<BilheteAereoCsvArchive>;
}
