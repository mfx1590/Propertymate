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

    // TD3: the second of two 44-ish lines, starting with the document number.
    const td3 = mrz.find((l, i) => i > 0 && l.length >= 40 && !l.startsWith('P<') && !l.startsWith('I<'));
    if (td3) {
      const num = this.clean(td3.slice(0, 9));
      if (num) return num;
    }
    // TD1: the first line begins with the document code and issuer, then the number.
    const td1 = mrz.find((l) => l.length >= 28 && l.length <= 32 && /^[ACI][A-Z<]/.test(l));
    if (td1) {
      const num = this.clean(td1.slice(5, 14));
      if (num) return num;
    }

    // Visual zone fallback: a label, then the number.
    const joined = text.toUpperCase().replace(/[\r\n]+/g, ' ');
    const labelled = /(?:PASSPORT\s*NO|DOCUMENT\s*NO|KIMLIK\s*NO|ID\s*NO|SERI\s*NO|NO)\s*[:.]?\s*([A-Z0-9][A-Z0-9 ]{5,13}[A-Z0-9])/.exec(joined);
    if (labelled) {
      const num = this.clean(labelled[1]);
      if (num && /\d/.test(num)) return num;
    }
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
