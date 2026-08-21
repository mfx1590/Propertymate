import { useRouter } from 'expo-router';
import { EmptyState } from './ui';
import { useI18n } from '../i18n';

/**
 * What a signed-out visitor sees on the account-bound tabs. Deliberately the
 * same shape as an empty state: it says why the screen is blank and gives the
 * one control that fixes it.
 */
export function SignInPrompt() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <EmptyState
      icon="🔐"
      title={t('auth.needAccount')}
      body={t('auth.needAccountBody')}
      actionLabel={t('common.signIn')}
      onAction={() => router.push('/auth')}
    />
  );
}
