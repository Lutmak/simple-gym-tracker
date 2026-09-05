import React, { ReactNode, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { Row } from './Row';
import { spacing, tabBar } from '../utils/scale';

/**
 * One row that expands in place to reveal its content (SPEC.md U3 "CICLOS ANTERIORES") — never a
 * second surface: expanding just grows the same flat list, hairline-divided like every other Row,
 * which is why this is a primitive of its own rather than a `Section` (ADR-0030 forbids nesting a
 * `Section` inside a `Section`, and a collapsed history row belongs wherever the screen already is).
 */
export type CollapsibleRowProps = {
  label: string;
  /** Secondary text while collapsed — SPEC.md's own count-with-noun rule applies here too. */
  detail?: string;
  children: ReactNode;
  testID?: string;
};

export function CollapsibleRow({ label, detail, children, testID }: CollapsibleRowProps) {
  const { tokens } = useTheme();
  const [expanded, setExpanded] = useState(false);

  return (
    <View testID={testID}>
      <Row
        label={label}
        detail={detail}
        right={
          <Ionicons
            name={expanded ? 'chevron-down' : 'chevron-forward'}
            size={tabBar.icon}
            color={tokens.textSecondary}
          />
        }
        onPress={() => setExpanded((current) => !current)}
        divided={expanded}
        testID={testID === undefined ? undefined : `${testID}-toggle`}
      />
      {expanded && (
        <View style={styles.content} testID={testID === undefined ? undefined : `${testID}-content`}>
          {children}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.cardGap,
    paddingTop: spacing.cardGap,
  },
});
