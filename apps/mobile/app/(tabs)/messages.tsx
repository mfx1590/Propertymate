import { useCallback, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { apiGet } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import type { Conversation } from '../../src/lib/types';
import { EmptyState, Loading } from '../../src/components/ui';
import { SignInPrompt } from '../../src/components/SignInPrompt';
import { pickI18n, useI18n } from '../../src/i18n';
import { fmtDateTime } from '../../src/lib/format';
import { colors, radius, space } from '../../src/theme';

export default function MessagesScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { me, loading } = useAuth();
  const [convos, setConvos] = useState<Conversation[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!me) return;
      void apiGet<Conversation[]>('/users/me/conversations').then(setConvos);
    }, [me]),
  );

  if (loading) return <Loading />;
  if (!me) return <SignInPrompt />;
  if (!convos) return <Loading />;

  if (convos.length === 0) {
    return (
      <EmptyState
        icon="💬"
        title={t('chat.emptyTitle')}
        body={t('chat.emptyBody')}
        actionLabel={t('chat.emptyAction')}
        onAction={() => router.push('/')}
      />
    );
  }

  return (
    <FlatList
      data={convos}
      keyExtractor={(c) => c.id}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/conversation/${item.id}`)}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
        >
          {item.property?.media[0] ? (
            <Image
              source={{ uri: item.property.media[0].url }}
              style={styles.thumb}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={[styles.thumb, styles.thumbFallback]}>
              <Text>🏠</Text>
            </View>
          )}
          <View style={styles.rowBody}>
            <Text numberOfLines={1} style={styles.title}>
              {pickI18n(item.property?.titleI18n, locale) || t('chat.title')}
            </Text>
            {item.lastMessage ? (
              <Text numberOfLines={1} style={styles.preview}>
                {item.lastMessage.body}
              </Text>
            ) : null}
            {/* §2.4 reveal gate — say why the other party has no name yet. */}
            {item.anonymous ? <Text style={styles.anon}>{t('chat.anonymous')}</Text> : null}
          </View>
          {item.lastMessage ? (
            <Text style={styles.when}>{fmtDateTime(item.lastMessage.createdAt, locale)}</Text>
          ) : null}
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.md,
  },
  thumb: { width: 52, height: 44, borderRadius: radius.sm, backgroundColor: colors.neutralBg },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  preview: { fontSize: 13, color: colors.textMuted },
  anon: { fontSize: 11, color: colors.textFaint },
  when: { fontSize: 11, color: colors.textFaint },
});
