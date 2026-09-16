import type { PlayerBalance } from "@workspace/db";

// Before player identity landed, a balance carried the player's name and no
// playerId; during the expand step it carried both. The backfill and
// reconciliation scripts still have to read (and repair) rows in those older
// shapes, which the current PlayerBalance type no longer describes.
export type StoredPlayerBalance = Omit<PlayerBalance, "playerId"> & {
  playerId?: number;
  name?: string;
};

export function storedBalances(value: unknown): StoredPlayerBalance[] {
  return (value ?? []) as StoredPlayerBalance[];
}
