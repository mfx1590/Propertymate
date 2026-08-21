import { Link, Tabs } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { useI18n } from '../../src/i18n';
import { colors } from '../../src/theme';

/**
 * Emoji stand in for icons so the app has no icon-font dependency yet; they
 * are marked decorative because the tab label already carries the meaning.
 */
function TabIcon({ glyph, color }: { glyph: string; color: string }) {
  return (
    <Text accessibilityElementsHidden importantForAccessibility="no" style={{ fontSize: 18, color }}>
      {glyph}
    </Text>
  );
}

export default function TabsLayout() {
  const { t } = useI18n();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.brand600,
        tabBarInactiveTintColor: colors.textFaint,
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: { color: colors.text, fontWeight: '700' },
        sceneStyle: { backgroundColor: colors.bg },
        // One way into account settings from every tab, rather than spending a
        // whole tab slot on a screen visited once.
        headerRight: () => (
          <Link href="/account" asChild>
            <Pressable accessibilityRole="button" accessibilityLabel={t('account.title')} hitSlop={8}>
              <Text style={{ fontSize: 18, paddingHorizontal: 16 }}>⚙️</Text>
            </Pressable>
          </Link>
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.search'),
          tabBarIcon: ({ color }) => <TabIcon glyph="🔍" color={color} />,
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: t('tabs.saved'),
          tabBarIcon: ({ color }) => <TabIcon glyph="♥" color={color} />,
        }}
      />
      <Tabs.Screen
        name="viewings"
        options={{
          title: t('tabs.viewings'),
          tabBarIcon: ({ color }) => <TabIcon glyph="📅" color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: t('tabs.messages'),
          tabBarIcon: ({ color }) => <TabIcon glyph="💬" color={color} />,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: t('tabs.alerts'),
          tabBarIcon: ({ color }) => <TabIcon glyph="🔔" color={color} />,
        }}
      />
    </Tabs>
  );
}
