import React, { ReactNode, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { fontSize, radius, spacing } from '../utils/scale';

/**
 * A bottom sheet — the app's one "decision about the thing you touched" surface (§3.5). It slides
 * up over a scrim that dims and dismisses; a push goes to a different place, and nothing else in
 * the app animates in. The panel is the only `surfaceRaised` in the system, which is why it can
 * only ever appear once and never inside another surface.
 *
 * Built on what the codebase already has: the Modal slide is the native motion, the scrim fade is
 * core Animated. Reanimated/gesture-handler exist in the tree but are not needed here, and core
 * Animated keeps the component testable under jest without the worklets setup.
 */

const CLOSE_ANIMATION_MS = 250;

export type SheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  testID?: string;
};

export function Sheet({ visible, onClose, title, children, testID }: SheetProps) {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const scrimOpacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      scrimOpacity.setValue(0);
      Animated.timing(scrimOpacity, {
        toValue: 1,
        duration: CLOSE_ANIMATION_MS,
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(scrimOpacity, {
        toValue: 0,
        duration: CLOSE_ANIMATION_MS,
        useNativeDriver: true,
      }).start(() => setMounted(false));
    }
  }, [visible, mounted, scrimOpacity]);

  if (!mounted) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop} testID={testID}>
        <Animated.View style={[styles.scrim, { backgroundColor: tokens.scrim, opacity: scrimOpacity }]}>
          <Pressable
            style={styles.scrimPressable}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t('sheetClose')}
          />
        </Animated.View>
        <View style={[styles.panel, { backgroundColor: tokens.surfaceRaised, paddingBottom: Math.max(insets.bottom, spacing.gutter) }]}>
          <View style={[styles.handle, { backgroundColor: tokens.divider }]} />
          {title !== undefined && (
            <Text style={[styles.title, { color: tokens.textPrimary }]} maxFontSizeMultiplier={1.5}>
              {title}
            </Text>
          )}
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
  },
  scrimPressable: {
    flex: 1,
  },
  panel: {
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.card,
    maxHeight: '85%',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: spacing.cardGap,
  },
  title: {
    fontSize: fontSize.cardTitle,
    fontWeight: '600',
    marginBottom: spacing.cardGap,
  },
});
