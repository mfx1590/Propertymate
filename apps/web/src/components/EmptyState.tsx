import type { ReactNode } from 'react';
import { Link } from '../i18n/routing';

/**
 * The one empty state used everywhere (UX pass, Plan §0 step 10 follow-up).
 *
 * An empty list is the first thing a new account sees, so "Nothing here yet"
 * on its own is a dead end: it reports a fact and offers no way out. Every
 * empty state therefore answers two questions — *what fills this?* (`body`)
 * and *what do I do now?* (`action`) — and the action is a real control, not
 * a sentence telling the user to go find one.
 *
 * `action` is omitted only when there is genuinely nothing the user can do
 * from here (see the offers board while `offers.enabled` is off), in which
 * case `body` has to carry the explanation on its own.
 */
export interface EmptyStateAction {
  label: string;
  /** Internal route. Mutually exclusive with `onClick`. */
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}

export interface EmptyStateProps {
  /** Decorative only — it is never the sole carrier of meaning. */
  icon?: ReactNode;
  title: string;
  /** One line: what will make rows appear here. */
  body: string;
  action?: EmptyStateAction;
  /** A lower-commitment way forward, rendered as a plain link. */
  secondary?: EmptyStateAction;
}

function ActionButton({ action, primary }: { action: EmptyStateAction; primary: boolean }) {
  const className = primary
    ? 'inline-block rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-900 disabled:opacity-50'
    : 'inline-block text-sm font-medium text-brand-600 hover:underline disabled:opacity-50';

  if (action.href) {
    return (
      <Link href={action.href} className={className}>
        {action.label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={action.onClick} disabled={action.disabled} className={className}>
      {action.label}
    </button>
  );
}

export function EmptyState({ icon, title, body, action, secondary }: EmptyStateProps) {
  return (
    <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-gray-50/60 px-6 py-10 text-center">
      {icon && (
        <div aria-hidden className="text-3xl">
          {icon}
        </div>
      )}
      <p className="mt-2 font-semibold text-gray-800">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">{body}</p>
      {(action || secondary) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
          {action && <ActionButton action={action} primary />}
          {secondary && <ActionButton action={secondary} primary={false} />}
        </div>
      )}
    </div>
  );
}
