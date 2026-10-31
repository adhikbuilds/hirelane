import { randomBytes } from 'node:crypto';
import type { ResumeFile } from './types';

export interface Payload {
  contentType: string;
  body: Uint8Array;
}

const enc = new TextEncoder();
const safe = (s: string): string => s.replace(/[\r\n"\\]/g, '_');

/** multipart/form-data with text fields and one resume file. Names and filenames cannot break out of their header line. */
export function buildMultipart(fields: [string, string][], resume: { field: string; file: ResumeFile } | null): Payload {
  const boundary = `----hirelane${randomBytes(12).toString('hex')}`;
  const parts: Uint8Array[] = [];
  for (const [name, value] of fields) {
    parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${safe(name)}"\r\n\r\n${value}\r\n`));
  }
  if (resume) {
    parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${safe(resume.field)}"; filename="${safe(resume.file.filename)}"\r\nContent-Type: ${safe(resume.file.mime)}\r\n\r\n`));
    parts.push(resume.file.bytes, enc.encode('\r\n'));
  }
  parts.push(enc.encode(`--${boundary}--\r\n`));
  const size = parts.reduce((n, p) => n + p.length, 0);
  const body = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    body.set(p, at);
    at += p.length;
  }
  return { contentType: `multipart/form-data; boundary=${boundary}`, body };
}
