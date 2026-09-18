// The rules of a recorded Mahjong session, shared by the API server (which
// enforces them) and the web app (which explains them while the form is being
// filled in). Keep this module dependency-free so both sides can import it.

export const PLAYERS_PER_SESSION = 4;

// What the group customarily plays for: $500 each across four players. Only
// ever used to prefill a new session — every calculation reads the base pot
// stored on the session itself.
export const CUSTOMARY_BASE_POT = 2000;

// A fixed, arbitrary key for pg_advisory_xact_lock. Session writes and the
// player backfill/reconciliation scripts all take this lock so that
// identity-affecting player mutations (create/merge/link) never race.
export const PLAYER_WRITE_LOCK_KEY = 727501;

export function normalizePlayerName(name: string): string {
  // toLowerCase() (not toLocaleLowerCase()) so this stays locale-independent
  // and matches PostgreSQL's lower(trim(name)), which is not locale-aware.
  return name.trim().toLowerCase();
}

export function perPlayerShare(basePot: number): number {
  return basePot / PLAYERS_PER_SESSION;
}

export function netWinnings(endingAmount: number, basePot: number): number {
  return endingAmount - perPlayerShare(basePot);
}

export function isInProfit(endingAmount: number, basePot: number): boolean {
  return endingAmount > perPlayerShare(basePot);
}

export function validateBasePot(basePot: number): string | null {
  if (!Number.isInteger(basePot) || basePot <= 0) {
    return "Base pot must be a positive whole number of dollars";
  }
  if (basePot % PLAYERS_PER_SESSION !== 0) {
    return `Base pot must divide evenly among ${PLAYERS_PER_SESSION} players`;
  }
  return null;
}

export function validateEndingAmount(endingAmount: number): string | null {
  if (!Number.isInteger(endingAmount)) {
    return "Ending amounts must be whole dollars";
  }
  if (endingAmount < 0) {
    return "Ending amounts cannot be negative";
  }
  return null;
}

export type Allocation = {
  allocated: number;
  remaining: number;
  status: "under" | "balanced" | "over";
};

export function allocationAgainstBasePot(
  basePot: number,
  endingAmounts: number[],
): Allocation {
  const allocated = endingAmounts.reduce((total, amount) => total + amount, 0);
  const remaining = basePot - allocated;
  return {
    allocated,
    remaining,
    status: remaining === 0 ? "balanced" : remaining > 0 ? "under" : "over",
  };
}

type BalanceToValidate = {
  playerId: number;
  endingAmount: number;
};

/**
 * Checks the money in a session — the base pot and the four ending amounts —
 * and returns the first rule it breaks, or null when the money adds up.
 */
export function validateStakes(
  basePot: number,
  endingAmounts: number[],
): string | null {
  const basePotError = validateBasePot(basePot);
  if (basePotError) return basePotError;

  if (endingAmounts.length !== PLAYERS_PER_SESSION) {
    return `Exactly ${PLAYERS_PER_SESSION} players are required`;
  }
  for (const endingAmount of endingAmounts) {
    const amountError = validateEndingAmount(endingAmount);
    if (amountError) return amountError;
  }

  const { remaining } = allocationAgainstBasePot(basePot, endingAmounts);
  if (remaining !== 0) {
    return remaining > 0
      ? `Ending amounts are $${remaining} short of the $${basePot} base pot`
      : `Ending amounts exceed the $${basePot} base pot by $${-remaining}`;
  }
  return null;
}

/**
 * Checks a complete session (its base pot plus all four balances) and returns
 * the first rule it breaks, or null when it is valid. Whether each playerId
 * refers to an existing player is the caller's concern.
 */
export function validateSession(session: {
  basePot: number;
  playerBalances: BalanceToValidate[];
}): string | null {
  const stakesError = validateStakes(
    session.basePot,
    session.playerBalances.map((balance) => balance.endingAmount),
  );
  if (stakesError) return stakesError;

  const playerIds = new Set<number>();
  for (const balance of session.playerBalances) {
    if (!Number.isInteger(balance.playerId) || balance.playerId <= 0) {
      return "Every seat must reference a player";
    }
    if (playerIds.has(balance.playerId)) {
      return "A player cannot be recorded twice in one session";
    }
    playerIds.add(balance.playerId);
  }
  return null;
}

/** The player(s) holding the largest ending amount; several on a tie. */
export function largestStackPlayerIds(
  playerBalances: BalanceToValidate[],
): number[] {
  if (playerBalances.length === 0) return [];
  const largest = Math.max(...playerBalances.map((balance) => balance.endingAmount));
  return playerBalances
    .filter((balance) => balance.endingAmount === largest)
    .map((balance) => balance.playerId);
}
