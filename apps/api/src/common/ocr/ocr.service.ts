import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import sharp from 'sharp';
import { createWorker, type Worker } from 'tesseract.js';
import { PrismaService } from '../../prisma/prisma.service';

/** Below this on either edge nothing is legible — a thumbnail, not a document. */
const MIN_EDGE_PX = 200;
/** Above this the engine gets slower without reading better; a passport page at 2000px is plenty. */
const MAX_EDGE_PX = 2000;

/**
 * Reading the document number off an identity document (§13.2, step 28).
 *
 * **This is local OCR, not an AI API.** tesseract.js runs the Tesseract engine
 * as WebAssembly inside this process; no image leaves the server, no vendor
 * is called, and nothing here touches the deferred-AI decision (Change Log
 * 2026-08-31). It is also the classical, decades-old kind of OCR — good on a
 * flat scan, mediocre on a phone photo at an angle — and the code is written
 * around that honesty: a number that cannot be read confidently is recorded
 * as NOTHING, never guessed.
 *
 * Why the MRZ first: every passport and every TRNC ID card carries a
 * machine-readable zone in OCR-B, a font designed for exactly this, with the
 * document number at a fixed position. Reading that is far more reliable than
 * hunting the visual zone for "No:", and it is what real KYC pipelines do.
 * The labelled-number fallback exists for older cards and driving licences.
 *
 * The result feeds the §13.2 ban list as a second key beside the file hash:
 * a re-photographed passport hashes differently every time, but its number
 * does not. Step 21 said plainly that a hash catches the same *file*, not the
 * same *person* — this is the half it could not do.
 */
@Injectable()
export class OcrService implements OnModuleDestroy {
  private readonly logger = new Logger(OcrService.name);
  private worker: Promise<Worker> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * One worker per process, created on first use — loading the engine and
   * the language data costs a couple of seconds and ~50MB, which the first
   * identity upload pays and nothing else does.
   */
  private getWorker(): Promise<Worker> {
    if (!this.worker) {
      const langDir = process.env.OCR_LANG_PATH ?? resolve(process.cwd(), 'apps/api/ocr');
      const local = existsSync(join(langDir, 'eng.traineddata'));
      if (!local) {
        this.logger.warn(
          `No eng.traineddata in ${langDir} — tesseract.js will fetch it over the network on first use (run \`npm run ocr:fetch -w apps/api\` to vendor it)`,
        );
      }
      this.worker = createWorker('eng', 1, {
        ...(local ? { langPath: langDir, gzip: false } : {}),
        cachePath: langDir,
        logger: () => undefined,
        // Without this, tesseract.js handles a rejected job by `throw`ing on
        // process.nextTick — an uncaught exception that ends the process. The
        // job's own promise still rejects (and is caught in `recognise`); this
        // only turns the second, fatal report into a log line.
        errorHandler: (err: unknown) => this.logger.warn(`OCR worker error: ${err}`),
      }).then(async (w) => {
        // The MRZ alphabet plus what a printed number can contain. Narrowing
        // the whitelist is the single biggest accuracy lever on OCR-B text.
        await w.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<:. ' });
        return w;
      });
      this.worker.catch((err) => {
        this.logger.error(`OCR worker failed to start: ${err}`);
        this.worker = null;
      });
    }
    return this.worker;
  }

  async onModuleDestroy() {
    if (this.worker) {
      try {
        await (await this.worker).terminate();
      } catch {
        /* already gone */
      }
    }
  }

  /**
   * Validate and normalise an upload before the engine sees it.
   *
   * This exists because of a crash: a truncated 1×1 JPEG went straight into
   * tesseract, its worker failed to decode it, and tesseract.js re-throws
   * worker errors on `process.nextTick` — outside any try/catch — which took
   * the whole API down with one bad upload. sharp decodes inside an ordinary
   * promise, so a corrupt file is a caught error here; anything too small to
   * carry a readable number is skipped outright; and what does go on is a
   * clean, bounded PNG rather than whatever the phone produced.
   */
  private async preflight(buffer: Buffer): Promise<Buffer | null> {
    try {
      const image = sharp(buffer, { failOn: 'error' });
      const meta = await image.metadata();
      if (!meta.width || !meta.height || meta.width < MIN_EDGE_PX || meta.height < MIN_EDGE_PX) {
        return null;
      }
      return await image
        .rotate() // honour EXIF orientation — phones shoot passports sideways
        .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
        .grayscale()
        .png()
        .toBuffer();
    } catch (err) {
      this.logger.warn(`OCR preflight rejected the image: ${err}`);
      return null;
    }
  }

  /** Raw text off an image, or empty on any failure — OCR never throws upward. */
  async recognise(buffer: Buffer): Promise<string> {
    const clean = await this.preflight(buffer);
    if (!clean) return '';
    try {
      const worker = await this.getWorker();
      const { data } = await worker.recognize(clean);
      return data.text ?? '';
    } catch (err) {
      this.logger.warn(`OCR failed: ${err}`);
      return '';
    }
  }

  /**
   * Find the document number in OCR text.
   *
   * MRZ, in order of how much we trust it:
   *   TD3 (passports): two lines of 44; document number = line 2, chars 0–8
   *   TD1 (ID cards):  three lines of 30; document number = line 1, chars 5–13
   * Then the visual zone: a labelled "No" / "Passport No" / "Kimlik No" with an
   * alphanumeric of 6–12 characters after it.
   */
  extractDocumentNumber(text: string): string | null {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, '').toUpperCase())
      .filter(Boolean);

    // MRZ lines are the ones made almost entirely of the OCR-B alphabet, long
    // enough, and containing the `<` filler no natural line has.
    const mrz = lines.filter((l) => l.length >= 28 && /^[A-Z0-9<]+$/.test(l) && l.includes('<'));

    // The visual zone — "Passport No: X" printed on the page — is a second,
    // independent read of the same number. It cannot verify itself, but it
    // can be verified against the MRZ's check digit, which is what breaks the
    // tie when the MRZ read is off by a glyph.
    // Matched per line and without spaces inside the token: joining the page
    // into one string let the capture run past the number into the next line
    // ("P085175A P<GBR…" became "P085175AP"), which then disagreed with the
    // MRZ and threw away a good read.
    let visual: string | null = null;
    for (const line of text.toUpperCase().split(/\r?\n/)) {
      const m = /(?:PASSPORT\s*NO|DOCUMENT\s*NO|KIMLIK\s*NO|ID\s*NO|SERI\s*NO|\bNO)\s*[:.]?\s*([A-Z0-9]{6,14})\b/.exec(line);
      if (m) {
        visual = this.clean(m[1]);
        if (visual) break;
      }
    }

    // TD3: the second of two 44-ish lines, starting with the document number,
    // followed by its check digit.
    const td3 = mrz.find((l, i) => i > 0 && l.length >= 40 && !l.startsWith('P<') && !l.startsWith('I<'));
    if (td3) return this.verifiedMrzNumber(td3.slice(0, 9), td3[9], visual);
    // TD1: the first line begins with the document code and issuer, then the
    // number and its check digit.
    const td1 = mrz.find((l) => l.length >= 28 && l.length <= 32 && /^[ACI][A-Z<]/.test(l));
    if (td1) return this.verifiedMrzNumber(td1.slice(5, 14), td1[14], visual);

    // No MRZ at all (an older card, a licence): the visual read, unverified.
    return visual && /\d/.test(visual) ? visual : null;
  }

  /**
   * ICAO 9303 check digit: weights 7-3-1 repeating over the field, A=10…Z=35,
   * `<`=0, sum mod 10. Every MRZ document number is followed by one — which is
   * what makes an OCR read of it *verifiable* rather than merely plausible.
   */
  static mrzCheckDigit(field: string): number {
    const weights = [7, 3, 1];
    let sum = 0;
    for (let i = 0; i < field.length; i++) {
      const ch = field[i];
      const v = ch === '<' ? 0 : /[0-9]/.test(ch) ? Number(ch) : /[A-Z]/.test(ch) ? ch.charCodeAt(0) - 55 : 0;
      sum += v * weights[i % 3];
    }
    return sum % 10;
  }

  /**
   * Glyph pairs OCR-B readers confuse on a phone photo. Each entry lists what
   * a character may really have been; repairs try one substitution at a time
   * and keep only a candidate whose check digit verifies.
   */
  private static readonly CONFUSIONS: Record<string, string[]> = {
    O: ['0', 'Q', 'D'], '0': ['O', 'D', 'Q'],
    I: ['1', 'L', 'T'], '1': ['I', 'L', '7'],
    B: ['8', 'R'], '8': ['B', '3'],
    S: ['5'], '5': ['S', '6'],
    Z: ['2', '7'], '2': ['Z'],
    G: ['6', 'C'], '6': ['G', 'b'],
    Q: ['O', '0'], D: ['O', '0'],
    A: ['4'], '4': ['A'],
  };

  /**
   * The MRZ number, but only when its check digit agrees — repairing a single
   * confused glyph when that is what it takes.
   *
   * This exists because of a CI failure: the same synthetic passport rendered
   * 30% larger read one character differently, and a ban keyed on the number
   * silently missed. Real MRZ readers never trust the raw read; they trust the
   * check digit. When the check digit itself is unreadable (not a digit), the
   * raw read is returned unverified — better a matchable number than none —
   * and when it is readable but nothing verifies, the answer is nothing.
   */
  private verifiedMrzNumber(rawField: string, checkChar: string | undefined, visual: string | null): string | null {
    const field = rawField.padEnd(9, '<').slice(0, 9);
    const cleaned = this.clean(field);
    if (!cleaned) return null;
    // An unreadable check digit leaves nothing to verify against: the raw
    // read is kept — a matchable number beats none — unless the visual zone
    // disagrees, in which case neither can be trusted.
    if (checkChar === undefined || !/[0-9]/.test(checkChar)) {
      return visual && visual !== cleaned ? null : cleaned;
    }
    const expected = Number(checkChar);
    const verifies = (f: string) => OcrService.mrzCheckDigit(f.padEnd(9, '<').slice(0, 9)) === expected;

    if (verifies(field)) return cleaned;

    // The MRZ read failed its own check. Before guessing at glyphs, ask the
    // other read on the page: a visual-zone number that satisfies the MRZ
    // check digit is two independent reads agreeing, which is the strongest
    // evidence available.
    if (visual && verifies(visual)) {
      this.logger.log('OCR MRZ number failed its check digit; the visual-zone read verifies against it and is used');
      return visual;
    }

    // Single-glyph repairs. Check-digit arithmetic is mod 10, so roughly one
    // random substitution in ten "verifies" by accident — a first-wins search
    // returned a wrong number in testing. Only a UNIQUE verifying candidate is
    // trusted; two or more is ambiguity, and ambiguity records nothing.
    const candidates = new Set<string>();
    for (let i = 0; i < field.length; i++) {
      for (const alt of OcrService.CONFUSIONS[field[i]] ?? []) {
        const candidate = field.slice(0, i) + alt.toUpperCase() + field.slice(i + 1);
        if (verifies(candidate)) candidates.add(candidate);
      }
    }
    if (candidates.size === 1) {
      const [only] = candidates;
      this.logger.log(`OCR repaired an MRZ document number via its check digit (unique single-glyph repair)`);
      return this.clean(only);
    }
    this.logger.warn(
      candidates.size === 0
        ? 'OCR MRZ document number failed its check digit and no single-glyph repair verifies — recording nothing'
        : `OCR MRZ document number failed its check digit and ${candidates.size} repairs verify — ambiguous, recording nothing`,
    );
    return null;
  }

  /** Uppercase, strip MRZ filler and spaces; refuse anything too short to mean much. */
  private clean(raw: string): string | null {
    const s = raw.replace(/[<\s.]/g, '').toUpperCase();
    return s.length >= 6 && s.length <= 14 ? s : null;
  }

  /**
   * Run OCR for an uploaded identity document and record what was read.
   * Fire-and-forget from the upload path: a two-second engine pass must not
   * sit between a user pressing Upload and their confirmation, and a failure
   * here is a missing signal, not a failed upload.
   */
  async processDocument(documentId: string, buffer: Buffer): Promise<void> {
    try {
      const text = await this.recognise(buffer);
      const docNumber = this.extractDocumentNumber(text);
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          docNumber,
          docNumberHash: docNumber ? OcrService.hashNumber(docNumber) : null,
        },
      });
      if (docNumber) this.logger.log(`OCR read a document number for document ${documentId}`);
    } catch (err) {
      this.logger.warn(`OCR pass for document ${documentId} did not complete: ${err}`);
    }
  }

  static hashNumber(docNumber: string): string {
    return createHash('sha256').update(docNumber).digest('hex');
  }
}
