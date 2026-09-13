export const STARTING_BALANCE = 500;

// A fixed, arbitrary key for pg_advisory_xact_lock. Session writes and the
// player backfill/reconciliation scripts all take this lock so that
// identity-affecting player mutations (create/merge/link) never race.
export const PLAYER_WRITE_LOCK_KEY = 727501;

export function normalizePlayerName(name: string): string {
  // toLowerCase() (not toLocaleLowerCase()) so this stays locale-independent
  // and matches PostgreSQL's lower(trim(name)), which is not locale-aware.
  return name.trim().toLowerCase();
}
