/**
 * resume:render core (S3.8): builder answers to a one-page, single-column, ATS-readable PDF with pdfkit and the
 * bundled Noto Sans (OFL), so the rupee sign renders. Plain text only: no links/annotations, no images, no tables,
 * no JavaScript. The font size steps down until the content fits one page; if it never does we fail with `too_long`
 * rather than emit a second page (pdfkit would add one silently).
 */
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { RenderError, type BuilderAnswers } from './answers';

export { RenderError, builderFileName, parseBuilderAnswers } from './answers';
export type { BuilderAnswers, BuilderEducation, BuilderExperience, BuilderProject } from './answers';

const REGULAR = fileURLToPath(new URL('../../../assets/fonts/NotoSans-Regular.ttf', import.meta.url));
const BOLD = fileURLToPath(new URL('../../../assets/fonts/NotoSans-Bold.ttf', import.meta.url));
const SIZES = [10, 9.5, 9, 8.5, 8];
const MARGIN = 40;
const BULLET = '• ';

type Doc = InstanceType<typeof PDFDocument>;

function draw(doc: Doc, a: BuilderAnswers, size: number): void {
  const heading = (t: string) => {
    doc.moveDown(0.5).font('Bold').fontSize(size + 1).text(t, { lineGap: 1 });
    doc.font('Regular').fontSize(size);
  };
  doc.font('Bold').fontSize(size + 8).text(a.name);
  doc.font('Regular').fontSize(size);
  doc.text([a.email, a.phone, a.city].filter(Boolean).join(' | '));
  if (a.links?.length) doc.text(a.links.join(' | '));
  if (a.summary) doc.moveDown(0.3).text(a.summary);

  heading('Education');
  for (const e of a.education) doc.text([`${e.qualification}, ${e.institution}`, e.score, e.year].filter(Boolean).join(', '));

  if (a.experience?.length) {
    heading('Experience');
    for (const x of a.experience) {
      doc.font('Bold').text([x.role, x.org, x.period].filter(Boolean).join(', ')).font('Regular');
      for (const b of x.bullets) doc.text(BULLET + b);
    }
  }

  heading('Projects');
  for (const p of a.projects) {
    doc.font('Bold').text(p.title).font('Regular');
    if (p.link) doc.text(p.link);
    for (const b of p.bullets) doc.text(BULLET + b);
  }

  heading('Skills');
  doc.text(a.skills.join(', '));
}

function build(a: BuilderAnswers, size: number): Promise<{ pdf: Buffer; pages: number }> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, font: REGULAR, info: { Title: 'Resume', Producer: 'Hirelane resume builder' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('error', reject);
    try {
      doc.registerFont('Regular', REGULAR);
      doc.registerFont('Bold', BOLD);
      draw(doc, a, size);
      const pages = doc.bufferedPageRange().count;
      doc.on('end', () => resolve({ pdf: Buffer.concat(chunks), pages }));
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

/** `a` must already be validated with parseBuilderAnswers. */
export async function renderResumePdf(a: BuilderAnswers): Promise<Buffer> {
  try {
    for (const size of SIZES) {
      const r = await build(a, size);
      if (r.pages === 1) return r.pdf;
    }
  } catch {
    throw new RenderError('render_failed');
  }
  throw new RenderError('too_long');
}
