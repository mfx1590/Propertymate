'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiGet } from '../../../lib/api';
import { Link } from '../../../i18n/routing';

type StepState = 'todo' | 'waiting' | 'done';

interface NextStep {
  key: string;
  state: StepState;
  href?: string;
  params?: Record<string, string | number>;
}

const MARK: Record<StepState, string> = { todo: '→', waiting: '⏳', done: '✓' };
const MARK_STYLE: Record<StepState, string> = {
  todo: 'text-brand-600',
  waiting: 'text-amber-600',
  done: 'text-emerald-600',
};

/**
 * "What do I do next?" — the checklist that answers the question a new account
 * actually has. The rules live in the API (NextStepsService); this only renders
 * copy for a key, so the two cannot drift.
 *
 * The first outstanding step is promoted into a prominent call to action rather
 * than being one grey line among many: a checklist where everything looks
 * equally important tells you nothing.
 */
export function NextSteps() {
  const t = useTranslations('nextSteps');
  const [data, setData] = useState<{ steps: NextStep[]; primary: string | null } | null>(null);

  useEffect(() => {
    apiGet<{ steps: NextStep[]; primary: string | null }>('/users/me/next-steps')
      .then(setData)
      .catch(() => setData({ steps: [], primary: null }));
  }, []);

  if (!data || data.steps.length === 0) return null;

  const primary = data.steps.find((s) => s.key === data.primary);
  const rest = data.steps.filter((s) => s.key !== data.primary);
  const done = data.steps.filter((s) => s.state === 'done').length;

  // `t.has` avoids throwing on a step the copy has not caught up with yet
  const label = (s: NextStep) =>
    t.has(`step.${s.key}`) ? t(`step.${s.key}`, { ...s.params }) : s.key;
  const hint = (s: NextStep) => (t.has(`hint.${s.key}`) ? t(`hint.${s.key}`, { ...s.params }) : null);

  return (
    <section className="mt-6 rounded-xl border border-gray-200 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-gray-700">{t('title')}</h2>
        <span className="text-xs text-gray-400">
          {t('progress', { done, total: data.steps.length })}
        </span>
      </div>

      {primary && (
        <div className="mt-3 rounded-lg bg-brand-50 p-4">
          <p className="font-medium text-brand-900">{label(primary)}</p>
          {hint(primary) && <p className="mt-1 text-sm text-brand-800/80">{hint(primary)}</p>}
          {primary.href && (
            <Link
              href={primary.href}
              className="mt-3 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white"
            >
              {t(`cta.${primary.key}`, { ...primary.params })}
            </Link>
          )}
        </div>
      )}

      <ul className="mt-3 space-y-1.5">
        {rest.map((s) => (
          <li key={s.key} className="flex items-start gap-2 text-sm">
            <span className={`${MARK_STYLE[s.state]} w-4 shrink-0`}>{MARK[s.state]}</span>
            <span className={s.state === 'done' ? 'text-gray-400 line-through' : 'text-gray-700'}>
              {s.href && s.state !== 'done' ? (
                <Link href={s.href} className="text-brand-600 hover:underline">
                  {label(s)}
                </Link>
              ) : (
                label(s)
              )}
              {s.state === 'waiting' && hint(s) && (
                <span className="ms-1 text-xs text-gray-400">— {hint(s)}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
