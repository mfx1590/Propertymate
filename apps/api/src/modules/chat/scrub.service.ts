import { Injectable } from '@nestjs/common';

export interface ScrubResult {
  body: string;
  scrubbed: boolean;
  /** what was caught, for the audit log / admin fraud review */
  hits: string[];
}

const MASK = '[hidden — contact details are shared after a confirmed viewing]';

/**
 * §2.4 + §13.6 anti-bypass: mask phone numbers (including spaced/obfuscated),
 * emails, and social handles/links until the platform allows contact exchange.
 * Every attempt is reported so admins can spot systematic bypassing.
 */
const PATTERNS: Array<[string, RegExp]> = [
  // emails
  ['email', /[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\])\s*[a-z0-9.-]+\s*(?:\.|\(dot\)|\[dot\])\s*[a-z]{2,}/gi],
  // t.me / wa.me / instagram / facebook links
  ['social_link', /(?:https?:\/\/)?(?:www\.)?(?:t\.me|wa\.me|telegram\.me|instagram\.com|facebook\.com|fb\.com|tiktok\.com)\/[^\s]+/gi],
  // "instagram: name", "telegram @name", "whatsapp me"
  ['social_mention', /\b(?:instagram|insta|telegram|whatsapp|viber|signal|snapchat|wechat)\b[\s:,-]*(?:@?[a-z0-9._-]{3,})?/gi],
  // @handles (not emails — emails already replaced)
  ['handle', /(?<![a-z0-9])@[a-z0-9._-]{3,}/gi],
  // phone numbers: +90 533 123 45 67, 0533-123-4567, 05331234567, also spelled with spaces/dots/dashes
  ['phone', /(?:\+|00)?\d[\d\s().-]{7,}\d/g],
];

@Injectable()
export class ScrubService {
  scrub(body: string): ScrubResult {
    let out = body;
    const hits: string[] = [];
    for (const [kind, pattern] of PATTERNS) {
      out = out.replace(pattern, (match) => {
        // phones: require at least 8 digits to avoid eating prices/areas
        if (kind === 'phone' && (match.match(/\d/g) ?? []).length < 8) return match;
        hits.push(`${kind}: ${match.trim().slice(0, 60)}`);
        return MASK;
      });
    }
    return { body: out, scrubbed: hits.length > 0, hits };
  }
}
