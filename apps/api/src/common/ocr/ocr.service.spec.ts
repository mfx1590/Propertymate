import { OcrService } from './ocr.service';

/**
 * The document-number extractor, exercised on crafted OCR text — no engine,
 * no image, milliseconds. These cases exist because CI caught the same
 * passport reading one glyph differently at a larger render, and a first
 * attempt at check-digit repair returned a *wrong* number that happened to
 * verify (mod-10 arithmetic accepts roughly one random substitution in ten).
 */
describe('OcrService.extractDocumentNumber', () => {
  const ocr = new OcrService(null as never);
  const cd = (f: string) => OcrService.mrzCheckDigit(f);

  const N = 'P085175A';
  const F = `${N}<`;
  const ok = cd(F);

  /** A TD3 data page: optional visual-zone line, then the two MRZ lines. */
  const page = (mrzField: string, check: string | number, visual: string | null) =>
    (visual ? `PASSPORT\nPassport No: ${visual}\n` : '') +
    'P<GBRDOE<<JOHN<ANDREW<<<<<<<<<<<<<<<<<<<<<<<<\n' +
    `${mrzField}${check}GBR8001011M3001011<<<<<<<<<<<<<<04`.padEnd(44, '<');

  it('computes the ICAO 9303 check digit (Doc 9303 sample L898902C3 → 6)', () => {
    expect(cd('L898902C3')).toBe(6);
  });

  it('accepts a clean MRZ read on its own check digit', () => {
    expect(ocr.extractDocumentNumber(page(F, ok, null))).toBe(N);
  });

  it.each([
    ['1 read as I', 'P085I75A<'],
    ['0 read as O', 'PO85175A<'],
    ['two glyphs wrong', 'PO85I75A<'],
    ['MRZ unreadable', 'XXXXXXXXX'],
  ])('rescues an MRZ misread (%s) with a visual-zone read that verifies against the check digit', (_label, mrz) => {
    expect(ocr.extractDocumentNumber(page(mrz, ok, N))).toBe(N);
  });

  it('never trusts an ambiguous single-glyph repair without a second read', () => {
    // 8→B with no visual zone: either the unique repair or nothing — never a
    // different number. (Uniqueness depends on the digits; both outcomes are
    // honest, a wrong number is not.)
    const got = ocr.extractDocumentNumber(page('P0B5175A<', ok, null));
    expect(got === N || got === null).toBe(true);
  });

  it('lets a verifying MRZ win over a disagreeing visual read', () => {
    expect(ocr.extractDocumentNumber(page(F, ok, 'P085175B'))).toBe(N);
  });

  it('records nothing when no read verifies', () => {
    expect(ocr.extractDocumentNumber(page('P085175B<', ok, 'P085175B'))).toBeNull();
  });

  it('keeps a raw MRZ read when the check digit is unreadable and the visual zone agrees', () => {
    expect(ocr.extractDocumentNumber(page(F, '<', N))).toBe(N);
  });

  it('records nothing when the check digit is unreadable and the two reads disagree', () => {
    expect(ocr.extractDocumentNumber(page(F, '<', 'P085175B'))).toBeNull();
  });

  it('falls back to an unverified visual read when there is no MRZ at all', () => {
    expect(ocr.extractDocumentNumber(`PASSPORT\nPassport No: ${N}\n`)).toBe(N);
  });

  it('does not let the visual capture bleed into the next token', () => {
    expect(ocr.extractDocumentNumber(`Passport No: ${N} TYPE P\n`)).toBe(N);
  });

  it('returns null for a page with nothing legible', () => {
    expect(ocr.extractDocumentNumber('')).toBeNull();
    expect(ocr.extractDocumentNumber('lorem ipsum dolor')).toBeNull();
  });
});
