export const COMMAND_EVENT = "meridian:command";

/** Opens the command palette from anywhere without prop drilling. */
export function openCommandPalette(): void {
  window.dispatchEvent(new Event(COMMAND_EVENT));
}
