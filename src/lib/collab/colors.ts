/**
 * The colour a person is drawn in — cursor, avatar, roster — on every screen.
 *
 * Shared by the server (presence over the wire) and the browser (the people
 * list in the share dialog), so the same person is the same colour wherever
 * their name appears.
 */

/** Eight distinguishable colours that read on both the light and the dark canvas. */
export const PRESENCE_PALETTE = [
  '#e5484d', // red
  '#f76b15', // orange
  '#ffb224', // amber
  '#30a46c', // green
  '#12a594', // teal
  '#0090ff', // blue
  '#6e56cf', // violet
  '#e93d82', // pink
] as const;

/** Deterministic: the same person is the same colour in every tab and on every screen. */
export function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return PRESENCE_PALETTE[Math.abs(hash) % PRESENCE_PALETTE.length];
}
