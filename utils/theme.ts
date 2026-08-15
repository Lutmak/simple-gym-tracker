/**
 * The semantic token layer — the only place in the app where a colour is named.
 *
 * Two rules make this file load-bearing (ENGINEERING.md §3.5):
 *
 * - A token is semantic, never raw. A screen must not be able to express "a light grey box with
 *   a 12px radius" — it can only ask for `surfaceRaised` and `radius.card`. Every raw value in
 *   this app lives here.
 * - A token never names a screen. `homeCardColor1` and its siblings were deleted with this file's
 *   arrival because they named their consumer; `surface`, `divider` and `accent` describe a role
 *   any screen may fill.
 *
 * The palette is monochrome on purpose — black, greys, white, one accent for the primary action
 * and the current position, and semantic colours only for state that must be read at a glance.
 * The maintainer's words, 2026-08-14: "me agradaba el estilo anterior: negro, gris y blanco".
 *
 * `accent` is **not** chromatic: it is the ink of the theme — black in light, white in dark. The
 * first implementation used blue, on the argument that a monochrome accent would leave the active
 * tab differing from an inactive one in weight alone. That argument does not hold: an active tab
 * is `accent` ink at weight 700 **with** a filled icon **and** an indicator pill, against
 * `textSecondary` grey at 500 with an outline icon and no pill. Three differences, one of which is
 * colour — black against 60% grey is a colour difference.
 *
 * Reviewed on the emulator, 2026-08-15: blue read as a second design language. Four accent-filled
 * segmented options on one Settings screen is not "used sparingly", and it contradicted the
 * maintainer's stated palette. Semantic colours stay chromatic — they are the only thing that must
 * be read at a glance without reading the word next to it.
 *
 * The `inputFill`/`disabled`/`scrim` tokens are not in the §3.5 list because the list predates
 * the primitives that need them: an input resting fill, an off-state control fill, and the sheet
 * backdrop have to come from somewhere, and "somewhere" is the token module or a raw literal.
 */

export type ThemeMode = 'light' | 'dark';

export interface ThemeTokens {
  /** The mode this set belongs to. Kept on the set so one value decides everything. */
  mode: ThemeMode;
  /** The canvas of a screen: behind everything. */
  surface: string;
  /** A layer above the screen — the bottom sheet. In light it is the same white, raised by the scrim. */
  surfaceRaised: string;
  /** Quiet resting fill of an input or control that is not the screen surface. */
  inputFill: string;
  /** Primary content: titles, labels, values. */
  textPrimary: string;
  /** Secondary content: details, helper copy, units. */
  textSecondary: string;
  /** The one accent: primary action and current position. Used sparingly. */
  accent: string;
  /** Content that sits on `accent`. */
  onAccent: string;
  /** State that must be read at a glance: done, completed, on track. */
  success: string;
  /** State that must be read at a glance: below target, changed, caution. */
  warning: string;
  /** Hairlines: list dividers, control borders. */
  divider: string;
  /** Content that is unavailable — disabled controls, off-state tracks. */
  disabled: string;
  /** The dimmed backdrop behind a sheet. */
  scrim: string;
}

export const lightTokens: ThemeTokens = {
  mode: 'light',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  inputFill: '#F7F7F7',
  textPrimary: '#000000',
  textSecondary: 'rgba(0, 0, 0, 0.6)',
  accent: '#000000',
  onAccent: '#FFFFFF',
  success: '#2E7D32',
  warning: '#B45309',
  divider: 'rgba(0, 0, 0, 0.12)',
  disabled: 'rgba(0, 0, 0, 0.25)',
  scrim: 'rgba(0, 0, 0, 0.5)',
};

export const darkTokens: ThemeTokens = {
  mode: 'dark',
  surface: '#121212',
  surfaceRaised: '#1E1E1E',
  inputFill: '#1E1E1E',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.6)',
  accent: '#FFFFFF',
  onAccent: '#000000',
  success: '#81C784',
  warning: '#FBBF24',
  divider: 'rgba(255, 255, 255, 0.15)',
  disabled: 'rgba(255, 255, 255, 0.25)',
  scrim: 'rgba(0, 0, 0, 0.6)',
};

export function getTokens(mode: ThemeMode): ThemeTokens {
  return mode === 'dark' ? darkTokens : lightTokens;
}

/**
 * The pre-design-system palette that the old screens read (`ThemeContext`'s `theme` object).
 *
 * This shape is a compatibility seam, not a second design language: every field resolves to a
 * token so no raw colour exists outside this module. It is deleted piece by piece as screens are
 * rebuilt against the primitives in Phases H–S; nothing new may consume it.
 */
export interface LegacyPalette {
  type: ThemeMode;
  background: string;
  text: string;
  card: string;
  border: string;
  buttonBackground: string;
  buttonText: string;
  inactivetint: string;
  logborder: string;
}

export function toLegacyPalette(tokens: ThemeTokens): LegacyPalette {
  return {
    type: tokens.mode,
    background: tokens.surface,
    text: tokens.textPrimary,
    card: tokens.inputFill,
    border: tokens.divider,
    buttonBackground: tokens.accent,
    buttonText: tokens.onAccent,
    inactivetint: tokens.disabled,
    logborder: tokens.divider,
  };
}
