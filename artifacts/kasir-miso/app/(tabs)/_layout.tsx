import React, { useCallback, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  useColorScheme,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather, Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TAB_ROUTES = ['/', '/kitchen', '/notes', '/calculator', '/other'] as const;

function getTabIndex(pathname: string) {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';

  if (normalizedPath === '/') return 0;

  const routeIndex = TAB_ROUTES.findIndex(
    (route) => route !== '/' && normalizedPath.endsWith(route),
  );

  return routeIndex >= 0 ? routeIndex : 0;
}

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const isDark = colorScheme === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';
  const pathname = usePathname();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const currentTabIndex = getTabIndex(pathname);
  const currentTabIndexRef = useRef(currentTabIndex);
  const swipeX = useRef(new Animated.Value(0)).current;
  const isAnimatingSwipeRef = useRef(false);
  currentTabIndexRef.current = currentTabIndex;
  const tabIcon = (name: React.ComponentProps<typeof Feather>['name']) =>
    ({ color, focused }: { color: string; focused: boolean }) => (
      <View style={s.tabIcon}>
        <Feather name={name} size={focused ? 25 : 20} color={color} />
      </View>
    );
  const cashierIcon = ({ color, focused }: { color: string; focused: boolean }) => (
    <View style={s.tabIcon}>
      <Ionicons name="calculator-outline" size={focused ? 27 : 22} color={color} />
    </View>
  );
  const tabLabel = (label: string) =>
    ({ color, focused }: { color: string; focused: boolean }) => (
      <Text style={[s.tabLabel, { color, fontSize: focused ? 11 : 10, fontWeight: focused ? '800' : '700' }]}>
        {label}
      </Text>
    );

  const navigateBySwipe = useCallback(
    (direction: number) => {
      const nextIndex = currentTabIndexRef.current + direction;

      if (nextIndex < 0 || nextIndex >= TAB_ROUTES.length || isAnimatingSwipeRef.current) {
        Animated.timing(swipeX, {
          toValue: 0,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
        return;
      }

      isAnimatingSwipeRef.current = true;
      const swipeDistance = Math.min(96, Math.max(72, width * 0.24));
      const exitOffset = direction > 0 ? -swipeDistance : swipeDistance;
      const enterOffset = -exitOffset;

      Animated.timing(swipeX, {
        toValue: exitOffset,
        duration: 180,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) {
          isAnimatingSwipeRef.current = false;
          return;
        }

        router.replace(TAB_ROUTES[nextIndex]);
        swipeX.setValue(enterOffset);
        Animated.timing(swipeX, {
          toValue: 0,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start(() => {
          isAnimatingSwipeRef.current = false;
        });
      });
    },
    [router, swipeX, width],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.abs(gestureState.dx) > 18 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.2,
        onPanResponderMove: (_, gestureState) => {
          if (!isAnimatingSwipeRef.current) {
            swipeX.setValue(gestureState.dx);
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (
            Math.abs(gestureState.dx) < 60 ||
            Math.abs(gestureState.dx) < Math.abs(gestureState.dy)
          ) {
            Animated.timing(swipeX, {
              toValue: 0,
              duration: 180,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }).start();
            return;
          }

          navigateBySwipe(gestureState.dx < 0 ? 1 : -1);
        },
        onPanResponderTerminate: () => {
          Animated.timing(swipeX, {
            toValue: 0,
            duration: 180,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }).start();
        },
      }),
    [navigateBySwipe, swipeX],
  );

  return (
    <View style={s.gestureArea} {...panResponder.panHandlers}>
      <Animated.View style={[s.screenTrack, { transform: [{ translateX: swipeX }] }]}>
        <Tabs
        screenOptions={{
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.mutedForeground,
          tabBarActiveBackgroundColor: colors.secondary,
          headerShown: false,
          tabBarHideOnKeyboard: true,
          tabBarStyle: {
            position: 'absolute',
            backgroundColor: isIOS ? 'transparent' : colors.card,
            borderTopWidth: isWeb ? 1 : 0,
            borderTopColor: colors.border,
            elevation: 0,
            height: isWeb ? 84 : 68 + insets.bottom,
            paddingTop: 7,
            paddingBottom: isWeb ? 7 : insets.bottom + 4,
            paddingHorizontal: 8,
          },
          tabBarItemStyle: {
            borderRadius: 15,
            marginHorizontal: 2,
            marginVertical: 4,
          },
          tabBarLabelStyle: {
            marginTop: 1,
          },
          tabBarIconStyle: {
            marginTop: 1,
          },
          tabBarBackground: () =>
            isIOS ? (
              <BlurView
                intensity={100}
                tint={isDark ? 'dark' : 'light'}
                style={StyleSheet.absoluteFill}
              />
            ) : isWeb ? (
              <View
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: colors.card },
                ]}
              />
            ) : null,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Kasir',
            tabBarLabel: tabLabel('Kasir'),
            tabBarIcon: cashierIcon,
          }}
        />
        <Tabs.Screen
          name="kitchen"
          options={{
            title: 'Dapur',
            tabBarLabel: tabLabel('Dapur'),
            tabBarIcon: tabIcon('clock'),
          }}
        />
        <Tabs.Screen
          name="notes"
          options={{
            title: 'Catatan',
            tabBarLabel: tabLabel('Catatan'),
            tabBarIcon: tabIcon('edit-3'),
          }}
        />
        <Tabs.Screen
          name="calculator"
          options={{
            title: 'Kalkulator',
            tabBarLabel: tabLabel('Hitung'),
            tabBarIcon: tabIcon('grid'),
          }}
        />
        <Tabs.Screen name="inventory" options={{ href: null }} />
        <Tabs.Screen name="expenses" options={{ href: null }} />
        <Tabs.Screen name="reports" options={{ href: null }} />
        <Tabs.Screen name="history" options={{ href: null }} />
        <Tabs.Screen
          name="other"
          options={{
            title: 'Lainnya',
            tabBarLabel: tabLabel('Lainnya'),
            tabBarIcon: tabIcon('more-horizontal'),
          }}
        />
        </Tabs>
      </Animated.View>
    </View>
  );
}

export default function TabLayout() {
  return <ClassicTabLayout />;
}

const s = StyleSheet.create({
  gestureArea: { flex: 1 },
  screenTrack: { flex: 1 },
  tabIcon: { minWidth: 42, height: 30, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { marginTop: 1 },
});
