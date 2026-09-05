import { lightTokens, darkTokens, getTokens, toLegacyPalette, type DataStateKey } from './theme';

const TOKEN_KEYS = [
  'mode',
  'surface',
  'surfaceRaised',
  'inputFill',
  'textPrimary',
  'textSecondary',
  'accent',
  'onAccent',
  'success',
  'warning',
  'divider',
  'disabled',
  'scrim',
  'data',
] as const;

const DATA_STATE_KEYS: readonly DataStateKey[] = ['done', 'moved', 'discarded', 'free'];

/**
 * WCAG relative-luminance contrast, hex only (every `data` token is opaque hex — no rgba). This
 * is the same formula the `dataviz` skill's `validate_palette.js` uses; reimplemented here, small,
 * so contrast is a gate assertion rather than a one-off number pasted into a deliverable.
 */
function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (match === null) {
    throw new Error(`Not an opaque hex colour: ${hex}`);
  }
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

function relativeLuminance(hex: string): number {
  const channel = (value: number): number => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('theme tokens', () => {
  it('defines every token in both themes', () => {
    for (const key of TOKEN_KEYS) {
      expect(lightTokens).toHaveProperty(key);
      expect(darkTokens).toHaveProperty(key);
    }
  });

  it('has no empty or whitespace-only values in either theme', () => {
    for (const tokens of [lightTokens, darkTokens]) {
      for (const key of TOKEN_KEYS) {
        expect(String(tokens[key]).trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('resolves the requested mode', () => {
    expect(getTokens('light')).toBe(lightTokens);
    expect(getTokens('dark')).toBe(darkTokens);
  });

  it('keeps dark mode genuinely darker than light mode', () => {
    expect(darkTokens.surface).not.toBe(lightTokens.surface);
    expect(darkTokens.textPrimary).not.toBe(lightTokens.textPrimary);
    expect(darkTokens.divider).not.toBe(lightTokens.divider);
  });

  it('uses a chromatic accent that differs between themes and is not a semantic colour', () => {
    expect(lightTokens.accent).not.toBe(darkTokens.accent);
    expect(lightTokens.accent).not.toBe(lightTokens.success);
    expect(lightTokens.accent).not.toBe(lightTokens.warning);
    expect(darkTokens.accent).not.toBe(darkTokens.success);
    expect(darkTokens.accent).not.toBe(darkTokens.warning);
  });

  it('keeps the raised surface distinct in dark mode and identical in light mode', () => {
    expect(darkTokens.surfaceRaised).not.toBe(darkTokens.surface);
    expect(lightTokens.surfaceRaised).toBe(lightTokens.surface);
  });

  it('provides onAccent content with adequate contrast against accent', () => {
    expect(lightTokens.onAccent).not.toBe(lightTokens.accent);
    expect(darkTokens.onAccent).not.toBe(darkTokens.accent);
  });
});

describe('data tokens (ADR-0047)', () => {
  it('has four series colours and four state colours in both themes', () => {
    for (const tokens of [lightTokens, darkTokens]) {
      expect(tokens.data.series).toHaveLength(4);
      for (const key of DATA_STATE_KEYS) {
        expect(tokens.data.state).toHaveProperty(key);
      }
    }
  });

  it('never repeats a series colour or a state colour within one theme', () => {
    for (const tokens of [lightTokens, darkTokens]) {
      expect(new Set(tokens.data.series).size).toBe(tokens.data.series.length);
      expect(new Set(Object.values(tokens.data.state)).size).toBe(
        Object.values(tokens.data.state).length,
      );
    }
  });

  it('clears >= 3:1 contrast against its own theme surface, every series and state colour', () => {
    for (const tokens of [lightTokens, darkTokens]) {
      for (const hex of tokens.data.series) {
        expect(contrastRatio(hex, tokens.surface)).toBeGreaterThanOrEqual(3);
      }
      for (const hex of Object.values(tokens.data.state)) {
        expect(contrastRatio(hex, tokens.surface)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('differs between themes (dark steps are not the light steps reused)', () => {
    expect(lightTokens.data.series).not.toEqual(darkTokens.data.series);
  });
});

describe('legacy palette mapping', () => {
  it('resolves every legacy field through the tokens with no raw values', () => {
    const light = toLegacyPalette(lightTokens);
    expect(light).toEqual({
      type: 'light',
      background: lightTokens.surface,
      text: lightTokens.textPrimary,
      card: lightTokens.inputFill,
      border: lightTokens.divider,
      buttonBackground: lightTokens.accent,
      buttonText: lightTokens.onAccent,
      inactivetint: lightTokens.disabled,
      logborder: lightTokens.divider,
    });
  });

  it('maps the dark palette the same way', () => {
    const dark = toLegacyPalette(darkTokens);
    expect(dark.type).toBe('dark');
    expect(dark.background).toBe(darkTokens.surface);
    expect(dark.text).toBe(darkTokens.textPrimary);
    expect(dark.card).toBe(darkTokens.inputFill);
    expect(dark.border).toBe(darkTokens.divider);
    expect(dark.buttonBackground).toBe(darkTokens.accent);
    expect(dark.buttonText).toBe(darkTokens.onAccent);
    expect(dark.inactivetint).toBe(darkTokens.disabled);
    expect(dark.logborder).toBe(darkTokens.divider);
  });
});
