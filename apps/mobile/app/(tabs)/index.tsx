import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { apiPublic } from '../../src/lib/api';
import type { RegionInfo, SearchResponse } from '../../src/lib/types';
import { ListingCard } from '../../src/components/ListingCard';
import { Button, ErrorNote, Loading } from '../../src/components/ui';
import { pickI18n, useI18n } from '../../src/i18n';
import { colors, radius, space } from '../../src/theme';

type Filters = {
  q: string;
  kind: string;
  region: string;
  minBeds: string;
};

const EMPTY: Filters = { q: '', kind: '', region: '', minBeds: '' };

/** Only the criteria this screen actually exposes can be offered as a fix. */
const CLEARABLE: Record<string, keyof Filters> = {
  q: 'q',
  kind: 'kind',
  region: 'region',
  minBeds: 'minBeds',
};

export default function SearchScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();

  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [draftQ, setDraftQ] = useState('');
  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiPublic<RegionInfo[]>('/regions').then(setRegions).catch(() => undefined);
  }, []);

  const runSearch = useCallback(async () => {
    const qs = new URLSearchParams();
    if (filters.q) qs.set('q', filters.q);
    if (filters.kind) qs.set('kind', filters.kind);
    if (filters.region) qs.set('region', filters.region);
    if (filters.minBeds) qs.set('minBeds', filters.minBeds);
    qs.set('sort', 'newest');
    try {
      setError(null);
      setData(await apiPublic<SearchResponse>(`/search/listings?${qs}`));
    } catch {
      setError(t('common.error'));
    }
  }, [filters, t]);

  useEffect(() => {
    void runSearch();
  }, [runSearch]);

  const suggestions = data?.suggestions;
  const relaxable = useMemo(
    () => (suggestions?.relax ?? []).filter((r) => r.filter in CLEARABLE),
    [suggestions],
  );

  const header = (
    <View style={styles.header}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.input}
          value={draftQ}
          onChangeText={setDraftQ}
          onSubmitEditing={() => setFilters((f) => ({ ...f, q: draftQ.trim() }))}
          placeholder={t('search.placeholder')}
          placeholderTextColor={colors.textFaint}
          returnKeyType="search"
          accessibilityLabel={t('search.placeholder')}
        />
        <Button title={t('common.search')} onPress={() => setFilters((f) => ({ ...f, q: draftQ.trim() }))} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        <Chip
          label={t('search.anyKind')}
          active={filters.kind === ''}
          onPress={() => setFilters((f) => ({ ...f, kind: '' }))}
        />
        <Chip
          label={t('search.forSale')}
          active={filters.kind === 'resale'}
          onPress={() => setFilters((f) => ({ ...f, kind: 'resale' }))}
        />
        <Chip
          label={t('search.forRent')}
          active={filters.kind === 'rental'}
          onPress={() => setFilters((f) => ({ ...f, kind: 'rental' }))}
        />
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        <Chip
          label={t('search.anyRegion')}
          active={filters.region === ''}
          onPress={() => setFilters((f) => ({ ...f, region: '' }))}
        />
        {regions.map((r) => (
          <Chip
            key={r.slug}
            label={pickI18n(r.nameI18n, locale)}
            active={filters.region === r.slug}
            onPress={() => setFilters((f) => ({ ...f, region: r.slug }))}
          />
        ))}
      </ScrollView>

      {data ? (
        <Text style={styles.count}>{t('search.results', { count: data.totalHits })}</Text>
      ) : null}
    </View>
  );

  /**
   * The mobile half of the §0 zero-result recovery: the API only sends these
   * when it found nothing, and only for routes it confirmed have listings, so
   * each chip below is guaranteed to land on results.
   */
  const noResults = suggestions ? (
    <View style={styles.recovery}>
      <Text style={styles.recoveryTitle}>{t('search.noResults.title')}</Text>
      <Text style={styles.recoveryBody}>{t('search.noResults.body')}</Text>

      {relaxable.length > 0 ? (
        <>
          <Text style={styles.recoveryLabel}>{t('search.noResults.widenLabel')}</Text>
          <View style={styles.recoveryChips}>
            {relaxable.map((r) => (
              <Chip
                key={r.filter}
                label={`${t(`search.noResults.drop.${r.filter}`)} (${r.totalHits})`}
                onPress={() => {
                  const key = CLEARABLE[r.filter];
                  if (key === 'q') setDraftQ('');
                  setFilters((f) => ({ ...f, [key]: '' }));
                }}
              />
            ))}
          </View>
        </>
      ) : null}

      {suggestions.regions.length > 0 ? (
        <>
          <Text style={styles.recoveryLabel}>{t('search.noResults.nearbyLabel')}</Text>
          <View style={styles.recoveryChips}>
            {suggestions.regions.map((r) => (
              <Chip
                key={r.slug}
                label={`${pickI18n(r.nameI18n, locale)} (${r.totalHits}${
                  r.distanceKm != null ? ` · ${Math.round(r.distanceKm)} km` : ''
                })`}
                onPress={() => setFilters((f) => ({ ...f, region: r.slug }))}
              />
            ))}
          </View>
        </>
      ) : null}

      <Button
        title={t('search.noResults.clearAll', { count: suggestions.totalLive })}
        onPress={() => {
          setDraftQ('');
          setFilters(EMPTY);
        }}
        style={styles.recoveryAction}
      />
    </View>
  ) : null;

  if (error) return <ErrorNote message={error} onRetry={runSearch} retryLabel={t('common.retry')} />;
  if (!data) return <Loading />;

  return (
    <FlatList
      data={data.hits}
      keyExtractor={(h) => h.id}
      ListHeaderComponent={header}
      ListEmptyComponent={noResults}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <ListingCard item={item} onPress={() => router.push(`/listing/${item.id}`)} />
      )}
    />
  );
}

function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && { opacity: 0.85 }]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  header: { gap: space.md },
  searchRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    color: colors.text,
    backgroundColor: colors.bg,
  },
  chipRow: { gap: space.sm, paddingRight: space.lg },
  chip: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: colors.bg,
  },
  chipActive: { backgroundColor: colors.brand50, borderColor: colors.brand500 },
  chipText: { fontSize: 13, color: colors.textMuted },
  chipTextActive: { color: colors.brand600, fontWeight: '700' },
  count: { fontSize: 13, color: colors.textMuted },

  recovery: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.bgMuted,
    padding: space.lg,
    gap: space.sm,
  },
  recoveryTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  recoveryBody: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  recoveryLabel: {
    marginTop: space.md,
    fontSize: 11,
    fontWeight: '700',
    color: colors.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  recoveryChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  recoveryAction: { marginTop: space.lg, alignSelf: 'flex-start' },
});
