import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Badge } from './ui';
import { useI18n } from '../i18n';
import { colors, radius, space } from '../theme';
import { fmtGbp } from '../lib/format';

export interface ListingCardData {
  id: string;
  title: string;
  regionName: string;
  district?: string | null;
  priceBaseGbp: number;
  bedrooms?: number | null;
  bathrooms?: number | null;
  areaM2?: number | null;
  deedType?: string;
  coverUrl?: string | null;
}

export function ListingCard({ item, onPress }: { item: ListingCardData; onPress: () => void }) {
  const { t } = useI18n();
  const specs = [
    item.bedrooms != null ? `${item.bedrooms} ${t('search.beds')}` : null,
    item.bathrooms != null ? `${item.bathrooms} ${t('search.baths')}` : null,
    item.areaM2 != null ? `${item.areaM2} m²` : null,
  ].filter(Boolean);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {item.coverUrl ? (
        <Image source={{ uri: item.coverUrl }} style={styles.cover} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.cover, styles.coverFallback]}>
          <Text style={styles.coverGlyph}>🏠</Text>
        </View>
      )}
      <View style={styles.body}>
        <View style={styles.badges}>
          <Badge label={`✓ ${t('common.verified')}`} tone={{ fg: colors.success, bg: colors.successBg }} />
          {item.deedType && item.deedType !== 'na' ? (
            <Badge label={t(`deed.${item.deedType}`)} tone={{ fg: colors.info, bg: colors.infoBg }} />
          ) : null}
        </View>
        <Text numberOfLines={1} style={styles.title}>
          {item.title}
        </Text>
        <Text numberOfLines={1} style={styles.meta}>
          {item.regionName}
          {item.district ? ` · ${item.district}` : ''}
        </Text>
        {specs.length > 0 ? <Text style={styles.meta}>{specs.join(' · ')}</Text> : null}
        <Text style={styles.price}>{fmtGbp(item.priceBaseGbp)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.bg,
  },
  pressed: { opacity: 0.9 },
  cover: { width: '100%', height: 170, backgroundColor: colors.neutralBg },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  coverGlyph: { fontSize: 34 },
  body: { padding: space.md, gap: 2 },
  badges: { flexDirection: 'row', gap: space.sm, marginBottom: space.xs },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
  price: { marginTop: space.xs, fontSize: 17, fontWeight: '800', color: colors.brand600 },
});
