/**
 * Locale-file guard (Plan §2.4 i18n).
 *
 * Key parity alone was the check this project had, and it passed for weeks
 * while `ru.json` and `fa.json` were 42% English by value — a key-set
 * comparison cannot see an untranslated *value*. This checks all three ways a
 * locale file goes wrong:
 *
 *   1. key parity        — a key present in one locale and missing in another
 *   2. placeholders      — {count} surviving translation, ICU plurals included
 *   3. untranslated text — a value byte-identical to English that has no
 *                          business being identical
 *
 * (3) needs an allowlist rather than a ratio: a threshold silently tolerates
 * whatever is already broken, and the number only ever creeps up. Anything
 * legitimately identical is named below, so adding one is a deliberate act
 * with a reason attached.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MESSAGES = join(dirname(fileURLToPath(import.meta.url)), '..', 'messages');
const BASE = 'en';

/** Keys whose value may match English, with the reason it may. */
const ALLOWED_IDENTICAL = {
  'common.appName': 'brand name',
  'dashboard.appName': 'brand name',
  'auth.emailPlaceholder': 'example address; the format is the point',
  'auth.phonePlaceholder': 'example number; the format is the point',
  'notificationSettings.channel.push': 'used as-is in ru; fa is translated',
  'notificationSettings.channel.whatsapp': 'brand name',
  'paymentSchedule.planLabel': 'tr: "Plan" is the Turkish word too',
  // The English name for these regions is already the Turkish name.
  'regionPage.names.iskele': 'Turkish place name',
  'regionPage.names.guzelyurt': 'Turkish place name',
  'regionPage.names.lefke': 'Turkish place name',
};

/** ICU-aware: an argument is `{name}` or `{name, plural, ...}`. */
const ARG = /\{\s*(\w+)\s*[,}]/g;
const argsOf = (s) => new Set([...String(s).matchAll(ARG)].map((m) => m[1]));

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, `${prefix}${k}.`));
    else out[`${prefix}${k}`] = v;
  }
  return out;
}

const locales = readdirSync(MESSAGES)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''));

const load = (loc) => flatten(JSON.parse(readFileSync(join(MESSAGES, `${loc}.json`), 'utf8')));

const base = load(BASE);
const baseKeys = new Set(Object.keys(base));
const problems = [];

for (const loc of locales) {
  if (loc === BASE) continue;
  const msgs = load(loc);
  const keys = new Set(Object.keys(msgs));

  for (const k of baseKeys) if (!keys.has(k)) problems.push(`${loc}: missing key  ${k}`);
  for (const k of keys) if (!baseKeys.has(k)) problems.push(`${loc}: extra key    ${k}`);

  for (const k of baseKeys) {
    if (!keys.has(k)) continue;
    const want = argsOf(base[k]);
    const got = argsOf(msgs[k]);
    if (want.size !== got.size || [...want].some((a) => !got.has(a))) {
      problems.push(`${loc}: placeholders ${k} — en{${[...want]}} vs ${loc}{${[...got]}}`);
    }
    if (msgs[k] === base[k] && !(k in ALLOWED_IDENTICAL)) {
      problems.push(`${loc}: untranslated ${k} = ${JSON.stringify(base[k]).slice(0, 60)}`);
    }
  }
}

if (problems.length) {
  console.error(`i18n check FAILED — ${problems.length} problem(s):\n`);
  for (const p of problems.slice(0, 40)) console.error('  ' + p);
  if (problems.length > 40) console.error(`  … and ${problems.length - 40} more`);
  console.error(
    '\nIf a value is genuinely meant to match English (a brand name, an example),' +
      '\nadd it to ALLOWED_IDENTICAL in this script with the reason.',
  );
  process.exit(1);
}

console.log(
  `i18n check passed — ${baseKeys.size} keys × ${locales.length} locales ` +
    `(${locales.join(', ')}); placeholders and translations verified.`,
);
