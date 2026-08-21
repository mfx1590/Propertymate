import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { colors, radius, space, STATUS_TONE } from '../theme';

export function Badge({ label, tone }: { label: string; tone?: { fg: string; bg: string } }) {
  const t = tone ?? { fg: colors.neutral, bg: colors.neutralBg };
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      <Text style={[styles.badgeText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <Badge label={label} tone={STATUS_TONE[status]} />;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  busy,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const isPrimary = variant === 'primary';
  const isGhost = variant === 'ghost';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        isPrimary && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        isGhost && styles.buttonGhost,
        (disabled || busy) && styles.buttonDisabled,
        pressed && styles.buttonPressed,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={isPrimary ? '#fff' : colors.brand600} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            isPrimary ? styles.buttonTextPrimary : styles.buttonTextSecondary,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * The mobile twin of apps/web/src/components/EmptyState.tsx — same rule: an
 * empty list says what will fill it and offers a real control, never just
 * "nothing here".
 */
export function EmptyState({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon?: string;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.empty}>
      {icon ? <Text style={styles.emptyIcon}>{icon}</Text> : null}
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} style={styles.emptyAction} />
      ) : null}
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.centre}>
      <ActivityIndicator color={colors.brand600} />
    </View>
  );
}

export function ErrorNote({ message, onRetry, retryLabel }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <View style={styles.errorNote}>
      <Text style={styles.errorText}>{message}</Text>
      {onRetry && retryLabel ? (
        <Button title={retryLabel} variant="ghost" onPress={onRetry} />
      ) : null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 11, fontWeight: '700' },

  button: {
    minHeight: 44,
    borderRadius: radius.md,
    paddingHorizontal: space.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: { backgroundColor: colors.brand600 },
  buttonSecondary: { borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.bg },
  buttonGhost: { paddingHorizontal: space.sm },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.85 },
  buttonText: { fontSize: 15, fontWeight: '600' },
  buttonTextPrimary: { color: '#fff' },
  buttonTextSecondary: { color: colors.brand600 },

  empty: {
    marginTop: space.xl,
    marginHorizontal: space.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    backgroundColor: colors.bgMuted,
    paddingVertical: space.xxl,
    paddingHorizontal: space.xl,
    alignItems: 'center',
  },
  emptyIcon: { fontSize: 30 },
  emptyTitle: { marginTop: space.sm, fontSize: 16, fontWeight: '700', color: colors.text, textAlign: 'center' },
  emptyBody: { marginTop: space.xs, fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
  emptyAction: { marginTop: space.lg },

  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },

  errorNote: {
    margin: space.lg,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.dangerBg,
    alignItems: 'flex-start',
    gap: space.sm,
  },
  errorText: { color: colors.danger, fontSize: 14 },

  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.bg,
    padding: space.md,
  },
  muted: { color: colors.textMuted, fontSize: 13 },
});
