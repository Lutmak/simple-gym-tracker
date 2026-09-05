/**
 * One type and spacing scale for the whole app.
 *
 * Before this existed every screen invented its own sizes: screen titles ranged from 28 to 36,
 * body text from 14 to 20, and card padding from 10 to 20. The result read as oversized and
 * inconsistent, and there was nothing to drift back towards.
 *
 * Two type roles, and the difference is load-bearing:
 *
 * - `fontSize` is **reading type** — titles, headings, labels, body copy, helper text. It is read
 *   with the phone in your hand at a normal distance, so it is sized for density.
 * - `displayFontSize` is **display type** — the rest timer, the workout timer, live stat values.
 *   It is read at arm's length with the phone on the floor between sets. It is deliberately large
 *   and is **not** part of the reduction. Shrinking it to match the reading scale would be a
 *   regression, not a tidy-up.
 *
 * `touchTarget.control` stays at 44 and must not be reduced: it is the platform minimum for a
 * tappable element, and this app is used with chalky, sweaty hands mid-set. Making the interface
 * denser is a type and spacing change, never a target-size change.
 */

/** Reading type. */
export const fontSize = {
  /** The one big heading at the top of a screen. */
  screenTitle: 24,
  /** A heading that divides a screen into parts. */
  sectionTitle: 19,
  /** The heading of a card or list row. */
  cardTitle: 16,
  /** Default running text and list-row detail. */
  body: 14,
  /** A field label sitting above an input. */
  label: 14,
  /** Button and chip labels. */
  button: 15,
  /** Secondary explanatory text, usually at reduced opacity. */
  helper: 13,
  /** Badges, units, timestamps, axis ticks. */
  caption: 12,
} as const;

/**
 * Display type — read from a distance, exempt from the reading scale by design.
 * Each value has one caller; the token exists to mark the intent, not to save a literal.
 */
export const displayFontSize = {
  /** Rest countdown, the largest thing in the app. */
  restTimer: 70,
  /** Elapsed workout time. */
  workoutTimer: 36,
  /** Completion screen headline. */
  completedTitle: 26,
  /** Live numeric readouts: sets done, volume, duration. */
  stat: 22,
  /** The unit suffix beside a display number. */
  displayUnit: 20,
} as const;

export const spacing = {
  /** Horizontal padding at the edge of a screen. */
  gutter: 16,
  /** Padding inside a card. */
  card: 12,
  /** Vertical gap between sibling cards or rows. */
  cardGap: 10,
  /** Vertical gap between sections of a screen. */
  section: 18,
  /** Gap between a label and the control it describes. */
  label: 6,
  /** Small inline gap, e.g. between an icon and its text. */
  inline: 6,
} as const;

export const touchTarget = {
  /** Buttons, chips, switches. The platform minimum — never reduce this. */
  control: 44,
  /** A full-width tappable row, which reads as larger than its height. */
  row: 46,
  /** A bare icon button; 40 with a 44-tall parent row still clears the minimum. */
  icon: 40,
} as const;

export const radius = {
  card: 12,
  control: 10,
  pill: 22,
} as const;

/**
 * The bottom tab bar — bespoke chrome that owns the raised centre action.
 * Sizes live here so the bar and its indicator never invent a number.
 */
export const tabBar = {
  /** Bar height, excluding the bottom safe-area inset — the platform's 56 dp content row. */
  height: 56,
  /** Tab icon size. */
  icon: 24,
} as const;

/** The active-tab indicator — the one accent element in the tab bar. */
export const tabIndicator = {
  width: 24,
  height: 3,
} as const;

/**
 * The raised circular centre button (SPEC.md §4.3): sized larger than a tab icon so it reads as
 * the one primary action, raised half its height above the bar so the icon row's centre line
 * passes through its middle. The bar reserves exactly that overhang as top padding.
 */
export const centreButton = {
  diameter: 56,
  icon: 26,
} as const;

/**
 * Data-identity marks (ADR-0047): the small colour swatches that carry a `data` token — a `Stat`
 * tile's colour dot, a chart legend dot. Never a chart mark itself (points/lines size from the
 * chart library), only the flat UI dots that sit beside text.
 */
export const dataMark = {
  dot: 8,
} as const;
