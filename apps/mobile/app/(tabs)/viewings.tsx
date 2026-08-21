import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { api, apiGet } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import type { Viewing } from '../../src/lib/types';
import { Button, Card, EmptyState, Loading, StatusBadge } from '../../src/components/ui';
import { SignInPrompt } from '../../src/components/SignInPrompt';
import { pickI18n, useI18n } from '../../src/i18n';
import { fmtDateTime } from '../../src/lib/format';
import { colors, space } from '../../src/theme';

export default function ViewingsScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { me, loading } = useAuth();
  const [items, setItems] = useState<Viewing[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!me) return;
    setItems(await apiGet<Viewing[]>('/users/me/viewings'));
  }, [me]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const setStatus = async (id: string, status: string) => {
    setBusy(id);
    try {
      await api(`/viewings/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Loading />;
  if (!me) return <SignInPrompt />;
  if (!items) return <Loading />;

  if (items.length === 0) {
    return (
      <EmptyState
        icon="📅"
        title={t('viewings.emptyTitle')}
        body={t('viewings.emptyBody')}
        actionLabel={t('viewings.emptyAction')}
        onAction={() => router.push('/')}
      />
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(v) => v.id}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => {
        const isHost = item.hostUserId === me.id;
        return (
          <Card>
            <View style={styles.row}>
              <StatusBadge status={item.status} label={t(`viewings.status.${item.status}`)} />
              <Text style={styles.role}>{isHost ? t('viewings.asHost') : t('viewings.asCustomer')}</Text>
            </View>
            <Text style={styles.title}>{pickI18n(item.property.titleI18n, locale)}</Text>
            <Text style={styles.when}>{fmtDateTime(item.scheduledAt, locale)}</Text>
            {item.notes ? <Text style={styles.notes}>{item.notes}</Text> : null}

            <View style={styles.actions}>
              {/* Only the host confirms; either side can call it off. */}
              {isHost && item.status === 'requested' ? (
                <Button
                  title={t('viewings.confirm')}
                  onPress={() => setStatus(item.id, 'confirmed')}
                  busy={busy === item.id}
                />
              ) : null}
              {['requested', 'confirmed'].includes(item.status) ? (
                <Button
                  title={t('viewings.cancel')}
                  variant="secondary"
                  onPress={() => setStatus(item.id, 'cancelled')}
                  busy={busy === item.id}
                />
              ) : null}
            </View>
          </Card>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  role: { fontSize: 12, color: colors.textFaint },
  title: { marginTop: space.sm, fontSize: 15, fontWeight: '700', color: colors.text },
  when: { fontSize: 14, color: colors.textMuted },
  notes: { marginTop: space.xs, fontSize: 13, color: colors.textMuted },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
});
