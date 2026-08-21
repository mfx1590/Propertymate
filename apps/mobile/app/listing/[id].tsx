import { useCallback, useEffect, useState } from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError, apiDelete, apiGet, apiPost, apiPublic, getAccessToken, loadTokens } from '../../src/lib/api';
import type { Property } from '../../src/lib/types';
import { Badge, Button, Card, ErrorNote, Loading } from '../../src/components/ui';
import { pickI18n, useI18n } from '../../src/i18n';
import { fmtDate, fmtGbp } from '../../src/lib/format';
import { colors, radius, space } from '../../src/theme';

export default function ListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const router = useRouter();

  const [property, setProperty] = useState<Property | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);
  const [favoured, setFavoured] = useState(false);
  const [message, setMessage] = useState('');
  const [sentMessage, setSentMessage] = useState(false);
  const [viewingAt, setViewingAt] = useState('');
  const [viewingDone, setViewingDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setError(null);
      setProperty(await apiPublic<Property>(`/properties/${id}`));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? t('listing.notFound') : t('common.error'));
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      await loadTokens();
      if (!getAccessToken()) return;
      setAuthed(true);
      try {
        const favs = await apiGet<Property[]>('/users/me/favorites');
        setFavoured(favs.some((f) => f.id === id));
      } catch {
        /* a failed favourites read must not blank the listing */
      }
    })();
  }, [id]);

  /** Everything below the fold needs an account; send them to sign in first. */
  const requireAuth = (fn: () => Promise<void>) => async () => {
    if (!authed) {
      router.push('/auth');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const toggleFavourite = requireAuth(async () => {
    if (favoured) {
      await apiDelete(`/properties/${id}/favorite`);
      setFavoured(false);
    } else {
      await apiPost(`/properties/${id}/favorite`);
      setFavoured(true);
    }
  });

  const enquire = requireAuth(async () => {
    await apiPost(`/properties/${id}/inquire`, { message: message.trim() });
    setMessage('');
    setSentMessage(true);
  });

  const requestViewing = requireAuth(async () => {
    const when = new Date(viewingAt);
    if (Number.isNaN(when.getTime())) throw new ApiError(400, t('common.error'));
    await apiPost(`/properties/${id}/viewings`, { scheduledAt: when.toISOString() });
    setViewingDone(true);
  });

  if (error) return <ErrorNote message={error} onRetry={load} retryLabel={t('common.retry')} />;
  if (!property) return <Loading />;

  const title = pickI18n(property.titleI18n, locale);
  const description = pickI18n(property.descriptionI18n, locale);
  const region = pickI18n(property.region.nameI18n, locale);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {property.media.length > 0 ? (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
          {property.media.map((m) => (
            <Image key={m.id} source={{ uri: m.url }} style={styles.photo} accessibilityIgnoresInvertColors />
          ))}
        </ScrollView>
      ) : (
        <View style={[styles.photo, styles.photoFallback]}>
          <Text style={styles.photoGlyph}>🏠</Text>
        </View>
      )}

      <View style={styles.body}>
        <View style={styles.badges}>
          <Badge label={`✓ ${t('common.verified')}`} tone={{ fg: colors.success, bg: colors.successBg }} />
          {property.deedType !== 'na' ? (
            <Badge label={t(`deed.${property.deedType}`)} tone={{ fg: colors.info, bg: colors.infoBg }} />
          ) : null}
        </View>

        <Text style={styles.title}>{title}</Text>
        <Text style={styles.meta}>
          {region}
          {property.district ? ` · ${property.district}` : ''}
        </Text>
        <Text style={styles.price}>{fmtGbp(Number(property.priceBaseGbp))}</Text>
        <Text style={styles.meta}>
          {t('listing.listed')} {fmtDate(property.createdAt, locale)}
        </Text>

        <Button
          title={favoured ? `♥ ${t('listing.saved')}` : `♡ ${t('listing.save')}`}
          variant="secondary"
          onPress={toggleFavourite}
          disabled={busy}
          style={styles.favourite}
        />

        {/* The trust promise, restated where the decision is made. */}
        <Card style={styles.trust}>
          <Text style={styles.trustTitle}>{t('listing.trustTitle')}</Text>
          <Text style={styles.trustBody}>{t('listing.trustBody')}</Text>
        </Card>

        {description ? (
          <Section title={t('listing.about')}>
            <Text style={styles.paragraph}>{description}</Text>
          </Section>
        ) : null}

        {property.features && property.features.length > 0 ? (
          <Section title={t('listing.features')}>
            <View style={styles.features}>
              {property.features.map((f) => (
                <Badge key={f} label={t(`features.${f}`)} />
              ))}
            </View>
          </Section>
        ) : null}

        <Section title={t('listing.enquire')}>
          {sentMessage ? (
            <Text style={styles.success}>{t('listing.sent')}</Text>
          ) : (
            <>
              <TextInput
                style={styles.textarea}
                value={message}
                onChangeText={setMessage}
                placeholder={t('listing.messagePlaceholder')}
                placeholderTextColor={colors.textFaint}
                accessibilityLabel={t('listing.messagePlaceholder')}
                multiline
              />
              <Text style={styles.note}>{t('listing.antiBypass')}</Text>
              <Button
                title={t('common.send')}
                onPress={enquire}
                busy={busy}
                disabled={!message.trim()}
              />
            </>
          )}
        </Section>

        <Section title={t('listing.requestViewing')}>
          {viewingDone ? (
            <Text style={styles.success}>{t('listing.viewingRequested')}</Text>
          ) : (
            <>
              <Text style={styles.label}>{t('viewings.whenLabel')}</Text>
              <TextInput
                style={styles.input}
                value={viewingAt}
                onChangeText={setViewingAt}
                placeholder="2026-09-01 14:00"
                placeholderTextColor={colors.textFaint}
                accessibilityLabel={t('viewings.whenLabel')}
              />
              <Button
                title={t('viewings.submit')}
                onPress={requestViewing}
                busy={busy}
                disabled={!viewingAt.trim()}
              />
            </>
          )}
        </Section>

        {!authed ? (
          <Card style={styles.signInPrompt}>
            <Text style={styles.trustTitle}>{t('auth.needAccount')}</Text>
            <Text style={styles.trustBody}>{t('auth.needAccountBody')}</Text>
            <Button title={t('common.signIn')} onPress={() => router.push('/auth')} style={styles.favourite} />
          </Card>
        ) : null}

        {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
      </View>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: space.xxl },
  photo: { width: 360, maxWidth: '100%', height: 240, backgroundColor: colors.neutralBg },
  photoFallback: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  photoGlyph: { fontSize: 44 },
  body: { padding: space.lg, gap: space.sm },
  badges: { flexDirection: 'row', gap: space.sm },
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  meta: { fontSize: 14, color: colors.textMuted },
  price: { fontSize: 24, fontWeight: '800', color: colors.brand600 },
  favourite: { marginTop: space.md, alignSelf: 'flex-start' },

  trust: { marginTop: space.lg, backgroundColor: colors.brand50, borderColor: colors.brand50 },
  trustTitle: { fontSize: 14, fontWeight: '700', color: colors.brand900 },
  trustBody: { marginTop: space.xs, fontSize: 13, color: colors.brand900, lineHeight: 19 },
  signInPrompt: { marginTop: space.lg, backgroundColor: colors.bgMuted },

  section: { marginTop: space.xl, gap: space.sm },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  paragraph: { fontSize: 14, color: colors.textMuted, lineHeight: 21 },
  features: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },

  label: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    color: colors.text,
  },
  textarea: {
    minHeight: 88,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    padding: space.md,
    color: colors.text,
    textAlignVertical: 'top',
  },
  note: { fontSize: 12, color: colors.textFaint, lineHeight: 17 },
  success: { color: colors.success, fontSize: 14, fontWeight: '600' },
  error: { marginTop: space.lg, color: colors.danger, fontSize: 14 },
});
