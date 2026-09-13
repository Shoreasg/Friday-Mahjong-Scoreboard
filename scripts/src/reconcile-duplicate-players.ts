import { readFileSync } from "node:fs";
import { db, mahjongSessionsTable, playersTable } from "@workspace/db";
import { normalizePlayerName, PLAYER_WRITE_LOCK_KEY } from "@workspace/session-rules";
import { asc, eq, inArray, sql } from "drizzle-orm";

type PlayerRow = { id: number; name: string; active: boolean };

// Explicit, operator-approved merge decisions: canonical player ID -> the
// loser IDs that should be folded into it. Required for every duplicate
// group — this script never guesses which row is canonical, because two
// different real people can share a normalized name and an automatic
// merge would silently delete one of their player records.
type MergeMappings = Map<number, Set<number>>;

type GroupResolution =
  | { ok: true; canonical: PlayerRow; losers: PlayerRow[] }
  | { ok: false; reason: string };

function loadMergeMappings(filePath: string | undefined): MergeMappings | undefined {
  if (!filePath) return undefined;
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, number[]>;
  const mappings: MergeMappings = new Map();
  // canonical ID -> the entry that claimed it, and loser ID -> the
  // canonical ID that claimed it — used below to reject any ID claimed by
  // more than one entry, in either role, before any merge runs.
  const canonicalOwners = new Map<number, number>();
  const loserOwners = new Map<number, number>();

  for (const [canonicalIdRaw, loserIds] of Object.entries(raw)) {
    const canonicalId = Number(canonicalIdRaw);
    if (!Number.isInteger(canonicalId) || canonicalId <= 0) {
      throw new Error(`Invalid canonical player ID in mappings file: ${canonicalIdRaw}`);
    }
    if (!Array.isArray(loserIds) || loserIds.some((id) => !Number.isInteger(id) || id <= 0)) {
      throw new Error(`Invalid loser player IDs for canonical #${canonicalId} in mappings file`);
    }
    if (loserIds.includes(canonicalId)) {
      throw new Error(`Canonical #${canonicalId} cannot also be listed as its own loser`);
    }
    if (loserOwners.has(canonicalId)) {
      throw new Error(
        `Canonical #${canonicalId} is also listed as a loser under canonical ` +
          `#${loserOwners.get(canonicalId)} — a player can't be both`,
      );
    }
    if (canonicalOwners.has(canonicalId)) {
      throw new Error(`Canonical #${canonicalId} appears more than once in the mappings file`);
    }
    canonicalOwners.set(canonicalId, canonicalId);

    for (const loserId of loserIds) {
      if (canonicalOwners.has(loserId)) {
        throw new Error(
          `Player #${loserId} is listed as a loser under canonical #${canonicalId} but is ` +
            `also a canonical ID itself — a player can't be both`,
        );
      }
      if (loserOwners.has(loserId) && loserOwners.get(loserId) !== canonicalId) {
        throw new Error(
          `Player #${loserId} is assigned as a loser to both canonical #${loserOwners.get(loserId)} ` +
            `and canonical #${canonicalId} — each player can only merge into one canonical`,
        );
      }
      loserOwners.set(loserId, canonicalId);
    }

    mappings.set(canonicalId, new Set(loserIds));
  }
  return mappings;
}

// Every duplicate group must be explicitly covered by an operator-approved
// mapping. There is no default guess (not even oldest-row-wins): two
// different real people can share a normalized name, and this script has
// no way to tell that apart from the same person's inconsistent
// capitalization. Supply PLAYER_MERGE_MAPPINGS_FILE — after reviewing a
// DRY_RUN=true report — to resolve real duplicates.
function resolveGroup(group: PlayerRow[], mappings: MergeMappings | undefined): GroupResolution {
  const groupIds = new Set(group.map((player) => player.id));
  const describe = (players: PlayerRow[]) =>
    players.map((player) => `#${player.id} (${player.name})`).join(", ");

  const matchingEntry = mappings
    ? [...mappings.entries()].find(([canonicalId]) => groupIds.has(canonicalId))
    : undefined;
  if (!matchingEntry) {
    return {
      ok: false,
      reason:
        `No approved merge mapping for duplicate name group: ${describe(group)}. Run with ` +
        `DRY_RUN=true to review, then supply PLAYER_MERGE_MAPPINGS_FILE covering every ` +
        `duplicate group before merging.`,
    };
  }

  const [canonicalId, approvedLoserIds] = matchingEntry;
  const coveredIds = new Set([canonicalId, ...approvedLoserIds]);
  const uncovered = group.filter((player) => !coveredIds.has(player.id));
  if (uncovered.length > 0) {
    return {
      ok: false,
      reason:
        `Merge mapping for canonical #${canonicalId} does not cover every row in the duplicate ` +
        `group: missing ${describe(uncovered)}`,
    };
  }
  const extra = [...approvedLoserIds].filter((id) => !groupIds.has(id));
  if (extra.length > 0) {
    return {
      ok: false,
      reason: `Merge mapping for canonical #${canonicalId} references IDs outside this duplicate group: ${extra.join(", ")}`,
    };
  }
  const canonical = group.find((player) => player.id === canonicalId);
  if (!canonical) {
    return { ok: false, reason: `Canonical player #${canonicalId} from mappings file was not found` };
  }
  return { ok: true, canonical, losers: group.filter((player) => player.id !== canonicalId) };
}

function groupDuplicates(players: PlayerRow[]): PlayerRow[][] {
  const groups = new Map<string, PlayerRow[]>();
  for (const player of players) {
    const key = normalizePlayerName(player.name);
    groups.set(key, [...(groups.get(key) ?? []), player]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

export async function reconcileDuplicatePlayers(): Promise<void> {
  const dryRun = process.env.DRY_RUN === "true";
  const mappings = loadMergeMappings(process.env.PLAYER_MERGE_MAPPINGS_FILE);

  const [tableCheck] = (
    await db.execute(sql`SELECT to_regclass('players') IS NOT NULL AS exists`)
  ).rows as { exists: boolean }[];
  if (!tableCheck?.exists) {
    console.log("players table does not exist yet; skipping reconciliation");
    return;
  }

  if (dryRun) {
    const players = await db.select().from(playersTable).orderBy(asc(playersTable.id));
    for (const group of groupDuplicates(players)) {
      const resolution = resolveGroup(group, mappings);
      if (!resolution.ok) {
        console.log(`[dry run] Unresolved duplicate group: ${resolution.reason}`);
        continue;
      }
      console.log(
        `[dry run] Would merge duplicate players into #${resolution.canonical.id} ` +
          `(${resolution.canonical.name}): ${resolution.losers
            .map((player) => `#${player.id} (${player.name})`)
            .join(", ")}`,
      );
    }
    return;
  }

  await db.transaction(async (tx) => {
    // Serialize against session writes and seedPlayers so this
    // reconciliation can't race a concurrent identity-affecting change.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${PLAYER_WRITE_LOCK_KEY})`);

    const players = await tx
      .select()
      .from(playersTable)
      .orderBy(asc(playersTable.id));

    for (const group of groupDuplicates(players)) {
      const resolution = resolveGroup(group, mappings);
      if (!resolution.ok) {
        throw new Error(resolution.reason);
      }
      const { canonical, losers } = resolution;
      const loserIds = losers.map((player) => player.id);

      console.log(
        `Merging duplicate players into #${canonical.id} (${canonical.name}): ${losers
          .map((player) => `#${player.id} (${player.name})`)
          .join(", ")}`,
      );

      if (losers.some((player) => player.active) && !canonical.active) {
        await tx
          .update(playersTable)
          .set({ active: true })
          .where(eq(playersTable.id, canonical.id));
      }

      const sessions = await tx
        .select({
          id: mahjongSessionsTable.id,
          playerBalances: mahjongSessionsTable.playerBalances,
        })
        .from(mahjongSessionsTable);
      for (const session of sessions) {
        const balances = session.playerBalances ?? [];
        const remapped = balances.map((balance) =>
          balance.playerId !== undefined && loserIds.includes(balance.playerId)
            ? { ...balance, playerId: canonical.id, name: canonical.name }
            : balance,
        );
        if (JSON.stringify(remapped) !== JSON.stringify(balances)) {
          await tx
            .update(mahjongSessionsTable)
            .set({ playerBalances: remapped })
            .where(eq(mahjongSessionsTable.id, session.id));
        }
      }

      await tx.delete(playersTable).where(inArray(playersTable.id, loserIds));
    }
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await reconcileDuplicatePlayers();
}
