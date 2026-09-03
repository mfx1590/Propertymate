import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

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

/**
 * Resolved through the package rather than a path relative to this file, so it
 * works the same from `src/` under ts-node and from `dist/` in the container.
 * `createRequire` because this compiles to CommonJS, where `import.meta` is
 * unavailable.
 */
const require_ = createRequire(__filename);
const fontPath = (file: string) => require_.resolve(`dejavu-fonts-ttf/ttf/${file}`);
const UNICODE_REGULAR = readFileSync(fontPath('DejaVuSans.ttf'));
const UNICODE_BOLD = readFileSync(fontPath('DejaVuSans-Bold.ttf'));

const MARGIN = 56;
const PAGE = { width: 595.28, height: 841.89 }; // A4 portrait
const BODY_SIZE = 10;
const LINE = 14;

/**
 * Contract PDF rendering (Plan §7 "template PDF generated", §6.2 mandate).
 *
 * Renders with an embedded DejaVu Sans rather than pdf-lib's built-in
 * Helvetica, which is WinAnsi-encoded and cannot represent Turkish ı/ş/ğ or
 * Cyrillic at all — those used to be transliterated away, so a Russian party
 * signed a document with their own name spelled in Latin.
 *
 * **Farsi is deliberately not rendered in Farsi.** The font has the glyphs, but
 * Arabic script needs contextual shaping and bidi reordering, and pdf-lib draws
 * glyphs in the order given with no shaping engine. Measured on this font,
 * shaping "سلام" yields 3 glyphs where a naive per-codepoint lookup yields 4
 * different ones — so embedding the font alone produces disconnected letters in
 * the wrong order. Unreadable text in a legal document is worse than English
 * text, so FA contracts render in English and say so. Fixing it properly needs
 * a shaping pass (harfbuzz//`fontkit.layout`) feeding positioned glyphs, or an
 * HTML-to-PDF renderer.
 */
@Injectable()
export class ContractPdfService {
  async render(spec: ContractSpec): Promise<Buffer> {
    const pdf = await PDFDocument.create();
    pdf.setTitle(spec.title);
    pdf.setProducer('PropVerify');
    pdf.setCreationDate(new Date());

    pdf.registerFontkit(fontkit);
    // Subset so a 739KB face does not ride along in full on every contract.
    const font = await pdf.embedFont(UNICODE_REGULAR, { subset: true });
    const bold = await pdf.embedFont(UNICODE_BOLD, { subset: true });

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

/**
 * Arabic-script ranges. Present in the font but not shapeable here (see the
 * class docblock), so they are stripped rather than drawn wrong. Reaching this
 * means something bypassed the locale fallback, and a gap is a louder signal
 * than a line of mangled glyphs.
 */
const UNSHAPEABLE = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g;

/**
 * The embedded face covers Latin, Turkish and Cyrillic, so nothing in those
 * scripts needs substituting any more. This is now only a guard: a character
 * the font cannot draw would otherwise throw mid-render and lose the whole
 * document.
 */
function safe(text: string): string {
  return text.replace(UNSHAPEABLE, '');
}
