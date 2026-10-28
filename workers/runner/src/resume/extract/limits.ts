/** Input gates shared by the parent (before any copy) and the extractor. No imports on purpose. */
export const MAX_BYTES = 5 * 1024 * 1024;

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);
export const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
export const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04

export const isPdfMagic = (b: Uint8Array) => startsWith(b, PDF_MAGIC);
export const isZipMagic = (b: Uint8Array) => startsWith(b, ZIP_MAGIC);
/** True when the bytes start with a PDF or ZIP signature. */
export const hasKnownMagic = (b: Uint8Array) => isPdfMagic(b) || isZipMagic(b);
