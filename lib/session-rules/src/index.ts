export const STARTING_BALANCE = 500;

export function normalizePlayerName(name: string): string {
  return name.trim().toLocaleLowerCase();
}