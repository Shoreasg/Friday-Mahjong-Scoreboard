import { normalizePlayerName } from "@workspace/session-rules";

export type PickablePlayer = {
  id: number;
  name: string;
  active: boolean;
};

export type PlayerPickerOptions<T extends PickablePlayer> = {
  /** Players offered for this seat, filtered by the typed text. */
  players: T[];
  /** Typed text that can become a new player (no existing player has it). */
  newPlayerName: string | null;
  /** An existing player matching the typed text who can't be picked here. */
  unavailableMatch: { player: T; reason: "inactive" | "seated" } | null;
};

/**
 * What one seat's picker offers: active players not already chosen for another
 * seat, narrowed by the typed text. The seat's own current player stays
 * listed even if they've since been marked inactive, so editing an old
 * session never silently loses a seat.
 */
export function playerPickerOptions<T extends PickablePlayer>(
  roster: T[],
  query: string,
  otherSeatPlayerIds: ReadonlySet<number>,
  selectedPlayerId: number | undefined,
): PlayerPickerOptions<T> {
  const normalizedQuery = normalizePlayerName(query);
  const players = roster
    .filter(
      (player) =>
        (player.active || player.id === selectedPlayerId) &&
        !otherSeatPlayerIds.has(player.id) &&
        normalizePlayerName(player.name).includes(normalizedQuery),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const exactMatch = normalizedQuery
    ? roster.find((player) => normalizePlayerName(player.name) === normalizedQuery)
    : undefined;

  let unavailableMatch: PlayerPickerOptions<T>["unavailableMatch"] = null;
  if (exactMatch && !players.includes(exactMatch)) {
    unavailableMatch = {
      player: exactMatch,
      reason: otherSeatPlayerIds.has(exactMatch.id) ? "seated" : "inactive",
    };
  }

  return {
    players,
    newPlayerName: normalizedQuery && !exactMatch ? query.trim() : null,
    unavailableMatch,
  };
}
