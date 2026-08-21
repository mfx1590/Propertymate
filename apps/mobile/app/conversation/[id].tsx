import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { apiGet, apiPost } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import type { ChatMessage } from '../../src/lib/types';
import { Button, ErrorNote, Loading, Muted } from '../../src/components/ui';
import { useI18n } from '../../src/i18n';
import { fmtDateTime } from '../../src/lib/format';
import { colors, radius, space } from '../../src/theme';

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setError(null);
      setMessages(await apiGet<ChatMessage[]>(`/conversations/${id}/messages`));
    } catch {
      setError(t('common.error'));
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    try {
      await apiPost(`/conversations/${id}/messages`, { message: body });
      setDraft('');
      await load();
      listRef.current?.scrollToEnd({ animated: true });
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  if (error && !messages) return <ErrorNote message={error} onRetry={load} retryLabel={t('common.retry')} />;
  if (!messages) return <Loading />;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Muted style={styles.threadEmpty}>{t('chat.threadEmpty')}</Muted>}
        renderItem={({ item }) => {
          const mine = item.senderId === me?.id;
          return (
            <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
              <Text style={[styles.body, mine && styles.bodyMine]}>{item.body}</Text>
              {/* §13.6: say when the anti-bypass filter changed the message,
                  so a stripped phone number does not look like a typo. */}
              {item.bodyScrubbed ? (
                <Text style={[styles.scrubbed, mine && styles.scrubbedMine]}>{t('chat.scrubbed')}</Text>
              ) : null}
              <Text style={[styles.when, mine && styles.whenMine]}>
                {fmtDateTime(item.createdAt, locale)}
              </Text>
            </View>
          );
        }}
      />

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={t('chat.placeholder')}
          placeholderTextColor={colors.textFaint}
          accessibilityLabel={t('chat.placeholder')}
          multiline
        />
        <Button title={t('common.send')} onPress={send} busy={busy} disabled={!draft.trim()} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: space.lg, gap: space.sm },
  threadEmpty: { textAlign: 'center', marginTop: space.xxl },
  bubble: { maxWidth: '82%', borderRadius: radius.lg, padding: space.md },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.brand600 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.neutralBg },
  body: { fontSize: 14, color: colors.text, lineHeight: 20 },
  bodyMine: { color: '#fff' },
  scrubbed: { marginTop: space.xs, fontSize: 11, color: colors.warn },
  scrubbedMine: { color: colors.warnBg },
  when: { marginTop: space.xs, fontSize: 10, color: colors.textFaint },
  whenMine: { color: 'rgba(255,255,255,0.7)' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    padding: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    color: colors.text,
  },
});
