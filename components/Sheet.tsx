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
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { fontSize, radius, spacing, tabBar, touchTarget } from '../utils/scale';

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
  onBack?: () => void;
  backAccessibilityLabel?: string;
  onClosed?: () => void;
  children: ReactNode;
  testID?: string;
};

export function Sheet({
  visible,
  onClose,
  title,
  onBack,
  backAccessibilityLabel,
  onClosed,
  children,
  testID,
}: SheetProps) {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const scrimOpacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      scrimOpacity.stopAnimation();
      scrimOpacity.setValue(0);
      Animated.timing(scrimOpacity, {
        toValue: 1,
        duration: CLOSE_ANIMATION_MS,
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      scrimOpacity.stopAnimation();
      Animated.timing(scrimOpacity, {
        toValue: 0,
        duration: CLOSE_ANIMATION_MS,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setMounted(false);
          onClosed?.();
        }
      });
    }
  }, [visible, mounted, onClosed, scrimOpacity]);

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
          {title !== undefined && onBack === undefined && (
            <Text style={[styles.title, { color: tokens.textPrimary }]} maxFontSizeMultiplier={1.5}>
              {title}
            </Text>
          )}
          {title !== undefined && onBack !== undefined && (
            <Pressable
              style={({ pressed }) => [
                styles.backHeader,
                pressed && { backgroundColor: tokens.inputFill },
              ]}
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel={backAccessibilityLabel ?? t('sheetBack')}
            >
              <Ionicons name="chevron-back" size={tabBar.icon} color={tokens.textPrimary} />
              <Text style={[styles.title, styles.backTitle, { color: tokens.textPrimary }]} maxFontSizeMultiplier={1.5}>
                {title}
              </Text>
            </Pressable>
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
    ...StyleSheet.absoluteFill,
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
  backHeader: {
    minHeight: touchTarget.control,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
    marginBottom: spacing.cardGap,
  },
  backTitle: {
    flex: 1,
    marginBottom: 0,
  },
});
