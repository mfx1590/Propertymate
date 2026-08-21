import { useCallback, useState } from 'react';
import { SectionList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { apiGet } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import type { Property, SavedSearch } from '../../src/lib/types';
import { ListingCard } from '../../src/components/ListingCard';
import { Card, EmptyState, Loading, Muted } from '../../src/components/ui';
import { SignInPrompt } from '../../src/components/SignInPrompt';
import { pickI18n, useI18n } from '../../src/i18n';
import { colors, space } from '../../src/theme';

export default function SavedScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { me, loading } = useAuth();
  const [favourites, setFavourites] = useState<Property[] | null>(null);
  const [searches, setSearches] = useState<SavedSearch[]>([]);

  // Favourites change on the listing screen, so re-read on focus rather than
  // once on mount — otherwise coming back shows a stale list.
  useFocusEffect(
    useCallback(() => {
      if (!me) return;
      void Promise.all([
        apiGet<Property[]>('/users/me/favorites'),
        apiGet<SavedSearch[]>('/users/me/saved-searches').catch(() => []),
      ]).then(([favs, saved]) => {
        setFavourites(favs);
        setSearches(saved);
      });
    }, [me]),
  );

  if (loading) return <Loading />;
  if (!me) return <SignInPrompt />;
  if (!favourites) return <Loading />;

  if (favourites.length === 0 && searches.length === 0) {
    return (
      <EmptyState
        icon="♥"
        title={t('saved.emptyTitle')}
        body={t('saved.emptyBody')}
        actionLabel={t('saved.emptyAction')}
        onAction={() => router.push('/')}
      />
    );
  }

  return (
    <SectionList
      contentContainerStyle={styles.list}
      sections={[
        { key: 'favourites', title: t('saved.favourites'), data: favourites },
        { key: 'searches', title: t('saved.searches'), data: [] as Property[] },
      ].filter((s) => s.key === 'favourites' || searches.length > 0)}
      keyExtractor={(item) => item.id}
      renderSectionHeader={({ section }) => (
        <Text style={styles.sectionTitle}>{section.title}</Text>
      )}
      renderSectionFooter={({ section }) =>
        section.key === 'searches' ? (
          <View style={styles.searches}>
            {searches.map((s) => (
              <Card key={s.id}>
                <Text style={styles.searchName}>{s.name}</Text>
                <Muted>{Object.values(s.query ?? {}).filter(Boolean).join(' · ')}</Muted>
              </Card>
            ))}
          </View>
        ) : null
      }
      renderItem={({ item }) => (
        <ListingCard
          item={{
            id: item.id,
            title: pickI18n(item.titleI18n, locale),
            regionName: pickI18n(item.region.nameI18n, locale),
            district: item.district,
            priceBaseGbp: Number(item.priceBaseGbp),
            bedrooms: item.bedrooms,
            bathrooms: item.bathrooms,
            areaM2: item.areaM2,
            deedType: item.deedType,
            coverUrl: item.media[0]?.url ?? null,
          }}
          onPress={() => router.push(`/listing/${item.id}`)}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    paddingVertical: space.sm,
    backgroundColor: colors.bg,
  },
  searches: { gap: space.sm },
  searchName: { fontSize: 14, fontWeight: '600', color: colors.text },
});
