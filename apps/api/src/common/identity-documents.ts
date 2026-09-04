/**
 * The document types that identify a PERSON rather than a property or a
 * company. Shared by the ban list (§13.2), the OCR pass (step 28) and the
 * upload hooks, so "which uploads are identity papers" has one answer.
 *
 * `selfie_with_id` is here because a ban snapshots it by file hash; OCR skips
 * it, since the ID in a selfie is too small to read and a wrong number is
 * worse than none.
 */
export const IDENTITY_DOCUMENT_TYPES = ['government_id', 'owner_id', 'selfie_with_id', 'signatory_id'] as const;

/** The subset worth running OCR on: a flat photo or scan of the document itself. */
export const OCR_DOCUMENT_TYPES = ['government_id', 'owner_id', 'signatory_id'] as const;

export const isIdentityDocument = (type: string) =>
  (IDENTITY_DOCUMENT_TYPES as readonly string[]).includes(type);

export const isOcrDocument = (type: string, mime: string) =>
  (OCR_DOCUMENT_TYPES as readonly string[]).includes(type) && /^image\/(jpeg|png|webp)$/i.test(mime);
