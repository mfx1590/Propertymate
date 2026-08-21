import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ApiError, apiPost } from '../src/lib/api';
import { useAuth } from '../src/lib/auth';
import { Button } from '../src/components/ui';
import { useI18n } from '../src/i18n';
import { colors, radius, space } from '../src/theme';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Sign-in only — account type is chosen at registration on the web (§0 change
 * log, 2026-07-10), and the mobile app is customer-facing, so there is nothing
 * here to pick. Both of the API's routes are offered because a customer who
 * signed up by email cannot receive an OTP.
 */
export default function AuthScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { signIn } = useAuth();

  const [tab, setTab] = useState<'phone' | 'email'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const done = async (tokens: TokenPair) => {
    await signIn(tokens);
    router.back();
  };

  const requestCode = () =>
    run(async () => {
      const res = await apiPost<{ sent: boolean; devCode?: string }>('/auth/otp/request', {
        phone: phone.trim(),
      });
      setSent(true);
      // The dev API returns the code instead of sending an SMS; surfacing it
      // keeps the app testable without an SMS provider.
      setDevCode(res.devCode ?? null);
    });

  const verifyCode = () =>
    run(async () =>
      done(await apiPost<TokenPair>('/auth/otp/verify', { phone: phone.trim(), code: code.trim() })),
    );

  const emailSignIn = () =>
    run(async () =>
      done(await apiPost<TokenPair>('/auth/login', { email: email.trim(), password })),
    );

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{t('auth.title')}</Text>
        <Text style={styles.subtitle}>{t('auth.subtitle')}</Text>

        <View style={styles.tabs}>
          <TabButton label={t('auth.phoneTab')} active={tab === 'phone'} onPress={() => setTab('phone')} />
          <TabButton label={t('auth.emailTab')} active={tab === 'email'} onPress={() => setTab('email')} />
        </View>

        {tab === 'phone' ? (
          <View style={styles.form}>
            <Field
              label={t('auth.phoneLabel')}
              value={phone}
              onChangeText={setPhone}
              placeholder={t('auth.phonePlaceholder')}
              keyboardType="phone-pad"
              autoComplete="tel"
              editable={!sent}
            />
            {!sent ? (
              <Button title={t('auth.sendCode')} onPress={requestCode} busy={busy} disabled={!phone.trim()} />
            ) : (
              <>
                {devCode ? <Text style={styles.devCode}>{t('auth.devCode', { code: devCode })}</Text> : null}
                <Field
                  label={t('auth.codeLabel')}
                  value={code}
                  onChangeText={setCode}
                  placeholder={t('auth.codePlaceholder')}
                  keyboardType="number-pad"
                  autoComplete="sms-otp"
                  maxLength={6}
                />
                <Button title={t('auth.verify')} onPress={verifyCode} busy={busy} disabled={code.trim().length < 4} />
                <Button
                  title={t('auth.resend')}
                  variant="ghost"
                  onPress={() => {
                    setSent(false);
                    setCode('');
                    setDevCode(null);
                  }}
                />
              </>
            )}
          </View>
        ) : (
          <View style={styles.form}>
            <Field
              label={t('auth.emailLabel')}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
            <Field
              label={t('auth.passwordLabel')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
            />
            <Button
              title={t('auth.emailSignIn')}
              onPress={emailSignIn}
              busy={busy}
              disabled={!email.trim() || !password}
            />
          </View>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button title={t('auth.browseInstead')} variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Button
      title={label}
      variant={active ? 'primary' : 'secondary'}
      onPress={onPress}
      style={styles.tabButton}
    />
  );
}

function Field({
  label,
  ...input
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...input}
        accessibilityLabel={label}
        placeholderTextColor={colors.textFaint}
        style={[styles.input, input.editable === false && styles.inputDisabled]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: space.xl, gap: space.lg },
  title: { fontSize: 24, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 15, color: colors.textMuted, lineHeight: 21 },
  tabs: { flexDirection: 'row', gap: space.sm },
  tabButton: { flex: 1 },
  form: { gap: space.md },
  field: { gap: space.xs },
  label: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    color: colors.text,
    backgroundColor: colors.bg,
  },
  inputDisabled: { backgroundColor: colors.bgMuted, color: colors.textMuted },
  devCode: {
    backgroundColor: colors.warnBg,
    color: colors.warn,
    padding: space.md,
    borderRadius: radius.md,
    fontSize: 13,
  },
  error: { color: colors.danger, fontSize: 14 },
});
