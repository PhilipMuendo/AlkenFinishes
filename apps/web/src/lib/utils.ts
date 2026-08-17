import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The one keyboard focus treatment in the app. `focus-visible` rather than
 * `focus` so a mouse click never draws a ring, but a Tab always does.
 *
 * Anything clickable that is not an `<Input>` (which carries its own inset
 * ring) should include this: links, tabs, icon buttons, cards, tiles.
 */
export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

/** As `focusRing`, but offset against the app background rather than a card. */
export const focusRingOnMuted =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-muted';
