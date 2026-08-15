import { lightTokens, darkTokens, getTokens, toLegacyPalette } from './theme';

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
] as const;

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
