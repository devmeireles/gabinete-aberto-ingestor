import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpBilheteAereoCsvArchiveSource } from "@/infrastructure/csv/http-bilhete-aereo-csv-archive-source";

function crc32(data: Buffer): number {
  let crc: number = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit: number = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(fileName: string, content: Buffer): Buffer {
  const name: Buffer = Buffer.from(fileName);
  const checksum: number = crc32(content);
  const localHeader: Buffer = Buffer.alloc(30 + name.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt32LE(checksum, 14);
  localHeader.writeUInt32LE(content.length, 18);
  localHeader.writeUInt32LE(content.length, 22);
  localHeader.writeUInt16LE(name.length, 26);
  name.copy(localHeader, 30);

  const centralHeader: Buffer = Buffer.alloc(46 + name.length);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt32LE(checksum, 16);
  centralHeader.writeUInt32LE(content.length, 20);
  centralHeader.writeUInt32LE(content.length, 24);
  centralHeader.writeUInt16LE(name.length, 28);
  name.copy(centralHeader, 46);

  const centralOffset: number = localHeader.length + content.length;
  const endRecord: Buffer = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(1, 8);
  endRecord.writeUInt16LE(1, 10);
  endRecord.writeUInt32LE(centralHeader.length, 12);
  endRecord.writeUInt32LE(centralOffset, 16);

  return Buffer.concat([localHeader, content, centralHeader, endRecord]);
}

describe("HTTP official bilhetes CSV archive source", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads a year ZIP and streams the matching CSV entry", async () => {
    const csv: Buffer = Buffer.from("header\nlinha\n");
    const zip: Buffer = createStoredZip("Ano-2025.csv", csv);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(zip, { status: 200 })),
    );

    const archive = await new HttpBilheteAereoCsvArchiveSource().openCsv(2025);
    const chunks: Uint8Array[] = [];
    for await (const chunk of archive.content) chunks.push(chunk);

    expect(archive.fileName).toBe("Ano-2025.csv");
    expect(Buffer.concat(chunks).toString("utf8")).toBe(csv.toString("utf8"));
  });

  it("fails explicitly when the download is unsuccessful", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );

    await expect(
      new HttpBilheteAereoCsvArchiveSource().openCsv(2025),
    ).rejects.toThrow("HTTP 404");
  });
});
