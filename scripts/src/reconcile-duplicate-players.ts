import { readFileSync } from "node:fs";
import { db, mahjongSessionsTable, playersTable } from "@workspace/db";
import { normalizePlayerName, PLAYER_WRITE_LOCK_KEY } from "@workspace/session-rules";
import { asc, eq, inArray, sql } from "drizzle-orm";

type PlayerRow = { id: number; name: string; active: boolean };

// Explicit, operator-approved merge decisions: canonical player ID -> the
// loser IDs that should be folded into it. Required whenever a duplicate
// group can't be resolved by the oldest-row-wins default (see below).
type MergeMappings = Map<number, Set<number>>;

function loadMergeMappings(filePath: string | undefined): MergeMappings | undefined {
  if (!filePath) return undefined;
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, number[]>;
  const mappings: MergeMappings = new Map();
  for (const [canonicalIdRaw, loserIds] of Object.entries(raw)) {
    const canonicalId = Number(canonicalIdRaw);
    if (!Number.isInteger(canonicalId) || canonicalId <= 0) {
      throw new Error(`Invalid canonical player ID in mappings file: ${canonicalIdRaw}`);
    }
    if (!Array.isArray(loserIds) || loserIds.some((id) => !Number.isInteger(id) || id <= 0)) {
      throw new Error(`Invalid loser player IDs for canonical #${canonicalId} in mappings file`);
    }
    mappings.set(canonicalId, new Set(loserIds));
  }
  return mappings;
}

function resolveCanonicalAndLosers(
  group: PlayerRow[],
  mappings: MergeMappings | undefined,
): { canonical: PlayerRow; losers: PlayerRow[] } {
  const groupIds = new Set(group.map((player) => player.id));

  if (mappings) {
    // Strict mode: the operator supplied a mappings file, so every
    // ambiguous group must be explicitly covered by it. Guessing
    // (oldest-row-wins) is not acceptable once explicit review is in play.
    const matchingEntry = [...mappings.entries()].find(([canonicalId]) =>
      groupIds.has(canonicalId),
    );
    if (!matchingEntry) {
      throw new Error(
        `No approved merge mapping for duplicate name group: ${group
          .map((player) => `#${player.id} (${player.name})`)
          .join(", ")}. Add an entry to the mappings file or resolve the ambiguity manually.`,
      );
    }
    const [canonicalId, approvedLoserIds] = matchingEntry;
    const coveredIds = new Set([canonicalId, ...approvedLoserIds]);
    const uncovered = group.filter((player) => !coveredIds.has(player.id));
    if (uncovered.length > 0) {
      throw new Error(
        `Merge mapping for canonical #${canonicalId} does not cover every row in the duplicate ` +
          `group: missing ${uncovered.map((player) => `#${player.id} (${player.name})`).join(", ")}`,
      );
    }
    const extra = [...approvedLoserIds].filter((id) => !groupIds.has(id));
    if (extra.length > 0) {
      throw new Error(
        `Merge mapping for canonical #${canonicalId} references IDs outside this duplicate group: ${extra.join(", ")}`,
      );
    }
    const canonical = group.find((player) => player.id === canonicalId);
    if (!canonical) {
      throw new Error(`Canonical player #${canonicalId} from mappings file was not found`);
    }
    return { canonical, losers: group.filter((player) => player.id !== canonicalId) };
  }

  // Default (no mappings file supplied): oldest row wins. This is the safe
  // assumption for this project's actual duplicates — inconsistent
  // capitalization of the same person's name, not two different people —
  // and keeps the automated dev/Docker flow working without operator
  // intervention. Anyone who needs to review ambiguous collisions before
  // merging can supply PLAYER_MERGE_MAPPINGS_FILE to switch to strict mode.
  const [canonical, ...losers] = group;
  return { canonical, losers };
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
    await db.execute(sql`SELECT to_regclass('public.players') IS NOT NULL AS exists`)
  ).rows as { exists: boolean }[];
  if (!tableCheck?.exists) {
    console.log("players table does not exist yet; skipping reconciliation");
    return;
  }

  if (dryRun) {
    const players = await db.select().from(playersTable).orderBy(asc(playersTable.id));
    for (const group of groupDuplicates(players)) {
      const { canonical, losers } = resolveCanonicalAndLosers(group, mappings);
      console.log(
        `[dry run] Would merge duplicate players into #${canonical.id} (${canonical.name}): ` +
          `${losers.map((player) => `#${player.id} (${player.name})`).join(", ")}`,
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
      const { canonical, losers } = resolveCanonicalAndLosers(group, mappings);
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
