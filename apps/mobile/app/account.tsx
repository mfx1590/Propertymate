import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { LOCALES, type Locale } from '@propverify/shared';
import { useAuth } from '../src/lib/auth';
import { Button, Card, Muted } from '../src/components/ui';
import { useI18n } from '../src/i18n';
import { colors, space } from '../src/theme';

const LANGUAGE_NAMES: Record<Locale, string> = {
  en: 'English',
  tr: 'Türkçe',
  ru: 'Русский',
  fa: 'فارسی',
};

export default function AccountScreen() {
  const { t, locale, setLocale } = useI18n();
  const { me, signOut } = useAuth();
  const router = useRouter();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {me ? (
        <Muted>{t('auth.signedInAs', { who: me.phone ?? me.email ?? me.id })}</Muted>
      ) : (
        <Button title={t('common.signIn')} onPress={() => router.push('/auth')} />
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('account.language')}</Text>
        <View style={styles.languages}>
          {LOCALES.map((l) => (
            <Button
              key={l}
              title={LANGUAGE_NAMES[l]}
              variant={l === locale ? 'primary' : 'secondary'}
              onPress={() => setLocale(l)}
            />
          ))}
        </View>
      </View>

      {/* Creating and verifying listings is a web task (deliberate: documents
          and the map pin belong on a desktop). Say so rather than leaving a
          seller wondering where the button is. */}
      <Card style={styles.note}>
        <Muted>{t('account.webNote')}</Muted>
      </Card>

      {me ? (
        <Button
          title={t('common.signOut')}
          variant="secondary"
          onPress={async () => {
            await signOut();
            router.back();
          }}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.xl, gap: space.xl },
  section: { gap: space.sm },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  languages: { gap: space.sm },
  note: { backgroundColor: colors.bgMuted },
});
