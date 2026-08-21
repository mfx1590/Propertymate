import { useCallback, useState } from 'react';
import { FlatList, Platform, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { apiGet, apiPost } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { registerPushToken } from '../../src/lib/push';
import type { AppNotification } from '../../src/lib/types';
import { Button, Card, EmptyState, Loading } from '../../src/components/ui';
import { SignInPrompt } from '../../src/components/SignInPrompt';
import { useI18n } from '../../src/i18n';
import { fmtDateTime } from '../../src/lib/format';
import { colors, space } from '../../src/theme';

export default function AlertsScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { me, loading } = useAuth();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [pushOn, setPushOn] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!me) return;
    setItems(await apiGet<AppNotification[]>('/users/me/notifications'));
  }, [me]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const enablePush = async () => {
    setBusy(true);
    try {
      setPushOn(Boolean(await registerPushToken()));
    } finally {
      setBusy(false);
    }
  };

  const markAllRead = async () => {
    await apiPost('/users/me/notifications/read-all');
    await load();
  };

  if (loading) return <Loading />;
  if (!me) return <SignInPrompt />;
  if (!items) return <Loading />;

  // The web preview has no native push module, so offering the button there
  // would be a control that cannot work.
  const canPush = Platform.OS !== 'web';
  const pushRow = canPush ? (
    <Card style={styles.pushCard}>
      <Text style={styles.pushText}>{pushOn ? t('alerts.pushOn') : t('alerts.pushOff')}</Text>
      {!pushOn ? (
        <Button
          title={t('alerts.enablePush')}
          variant="secondary"
          onPress={enablePush}
          busy={busy}
          style={styles.pushButton}
        />
      ) : null}
    </Card>
  ) : null;

  if (items.length === 0) {
    return (
      <View style={styles.flex}>
        {pushRow}
        <EmptyState
          icon="🔔"
          title={t('alerts.emptyTitle')}
          body={t('alerts.emptyBody')}
          actionLabel={t('alerts.emptyAction')}
          onAction={() => router.push('/')}
        />
      </View>
    );
  }

  const unread = items.filter((n) => !n.readAt).length;

  return (
    <FlatList
      data={items}
      keyExtractor={(n) => n.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.header}>
          {pushRow}
          {unread > 0 ? (
            <Button title={t('alerts.markAllRead')} variant="ghost" onPress={markAllRead} />
          ) : null}
        </View>
      }
      renderItem={({ item }) => (
        <Card style={!item.readAt ? styles.unread : undefined}>
          <Text style={styles.title}>{item.title ?? item.templateKey}</Text>
          {item.body ? <Text style={styles.body}>{item.body}</Text> : null}
          <Text style={styles.when}>{fmtDateTime(item.createdAt, locale)}</Text>
        </Card>
      )}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl },
  header: { gap: space.sm, marginBottom: space.sm },
  pushCard: { margin: space.lg, marginBottom: 0, backgroundColor: colors.brand50, borderColor: colors.brand50 },
  pushText: { fontSize: 13, color: colors.brand900, lineHeight: 19 },
  pushButton: { marginTop: space.md, alignSelf: 'flex-start' },
  unread: { borderColor: colors.brand500, backgroundColor: colors.brand50 },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  body: { marginTop: 2, fontSize: 13, color: colors.textMuted, lineHeight: 19 },
  when: { marginTop: space.xs, fontSize: 11, color: colors.textFaint },
});
