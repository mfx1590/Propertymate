import { Injectable } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export interface ContractParty {
  role: string;
  name: string;
  typedName?: string | null;
  signedAt?: Date | null;
}

export interface ContractSpec {
  title: string;
  reference: string;
  intro: string;
  /** label → value; rendered as a two-column facts table */
  facts: [string, string][];
  clauses: { heading: string; body: string }[];
  parties: ContractParty[];
  footer: string;
}

const MARGIN = 56;
const PAGE = { width: 595.28, height: 841.89 }; // A4 portrait
const BODY_SIZE = 10;
const LINE = 14;

/**
 * Contract PDF rendering (Plan §7 "template PDF generated", §6.2 mandate).
 *
 * Uses pdf-lib's built-in Helvetica, which is WinAnsi-encoded. That covers
 * English cleanly but cannot represent Turkish ı/ş/ğ, Cyrillic or Arabic, so
 * generated contracts are English-only for v1 and non-encodable characters are
 * transliterated rather than silently crashing the render. Producing TR/RU/FA
 * contracts means embedding a Unicode TTF (fontkit + a Noto face) — a deliberate
 * follow-up, not an oversight.
 */
@Injectable()
export class ContractPdfService {
  async render(spec: ContractSpec): Promise<Buffer> {
    const pdf = await PDFDocument.create();
    pdf.setTitle(spec.title);
    pdf.setProducer('PropVerify');
    pdf.setCreationDate(new Date());

    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    let page = pdf.addPage([PAGE.width, PAGE.height]);
    let y = PAGE.height - MARGIN;

    const newPage = () => {
      page = pdf.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - MARGIN;
    };
    const space = (n: number) => {
      if (y - n < MARGIN + 40) newPage();
      y -= n;
    };
    const draw = (text: string, opts: { font?: PDFFont; size?: number; x?: number; color?: [number, number, number] } = {}) => {
      page.drawText(safe(text), {
        x: opts.x ?? MARGIN,
        y,
        size: opts.size ?? BODY_SIZE,
        font: opts.font ?? font,
        color: opts.color ? rgb(...opts.color) : rgb(0.1, 0.1, 0.1),
      });
    };
    const paragraph = (text: string, f: PDFFont = font, size = BODY_SIZE) => {
      for (const line of wrap(safe(text), f, size, PAGE.width - MARGIN * 2)) {
        space(LINE);
        draw(line, { font: f, size });
      }
    };

    // ── header ────────────────────────────────────────────────────
    draw(spec.title, { font: bold, size: 18 });
    space(20);
    draw(spec.reference, { size: 9, color: [0.45, 0.45, 0.45] });
    space(8);
    rule(page, y, PAGE.width);
    space(16);

    paragraph(spec.intro);
    space(10);

    // ── facts table ───────────────────────────────────────────────
    for (const [label, value] of spec.facts) {
      space(LINE);
      draw(label, { font: bold });
      draw(value, { x: MARGIN + 170 });
    }
    space(16);

    // ── clauses ───────────────────────────────────────────────────
    for (const [i, clause] of spec.clauses.entries()) {
      space(LINE + 4);
      draw(`${i + 1}. ${clause.heading}`, { font: bold });
      paragraph(clause.body);
      space(6);
    }

    // ── signature blocks ──────────────────────────────────────────
    space(24);
    if (y < MARGIN + 160) newPage();
    draw('SIGNATURES', { font: bold, size: 12 });
    space(6);
    rule(page, y, PAGE.width);

    for (const party of spec.parties) {
      space(LINE + 10);
      draw(`${party.role}: ${party.name}`, { font: bold });
      space(LINE);
      if (party.signedAt && party.typedName) {
        // A typed signature carries weight only through its audit trail, so the
        // PDF states exactly what was typed and when.
        draw(`Signed electronically: "${party.typedName}"`, { color: [0.05, 0.4, 0.2] });
        space(LINE);
        draw(`Date: ${party.signedAt.toISOString().replace('T', ' ').slice(0, 19)} UTC`, {
          size: 9,
          color: [0.45, 0.45, 0.45],
        });
      } else {
        draw('Awaiting electronic signature', { color: [0.6, 0.35, 0.05] });
      }
      space(4);
      rule(page, y, PAGE.width, 0.85);
    }

    space(24);
    paragraph(spec.footer, font, 8);

    return Buffer.from(await pdf.save());
  }
}

function rule(page: PDFPage, y: number, width: number, shade = 0.75) {
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: width - MARGIN, y },
    thickness: 0.5,
    color: rgb(shade, shade, shade),
  });
}

/** Greedy wrap against the real glyph widths so nothing runs off the page. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const source of text.split('\n')) {
    let line = '';
    for (const word of source.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

const TRANSLITERATE: Record<string, string> = {
  ı: 'i', İ: 'I', ş: 's', Ş: 'S', ğ: 'g', Ğ: 'G', ö: 'o', Ö: 'O',
  ü: 'u', Ü: 'U', ç: 'c', Ç: 'C', '’': "'", '‘': "'", '“': '"', '”': '"', '—': '-', '–': '-',
};

/**
 * Helvetica is WinAnsi-only. A name with a Turkish ı in it must not crash the
 * render of a legal document, so unrepresentable characters are transliterated
 * where there is an obvious equivalent and dropped otherwise.
 */
function safe(text: string): string {
  return [...text]
    .map((ch) => TRANSLITERATE[ch] ?? ch)
    .filter((ch) => ch.charCodeAt(0) < 256)
    .join('');
}
