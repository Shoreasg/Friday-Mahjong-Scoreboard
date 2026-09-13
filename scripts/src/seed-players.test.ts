import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectResults: unknown[] = [];
  const mutationResults: unknown[][] = [];
  const updateCalls: { values: unknown; whereClause: unknown }[] = [];

  function selectChain(result: unknown) {
    const chain = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      for: vi.fn(),
      then: (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(result).then(resolve, reject),
    };
    chain.from.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);
    chain.for.mockReturnValue(chain);
    return chain;
  }

  const db = {
    selectResults,
    mutationResults,
    updateCalls,
    select: vi.fn(() => selectChain(selectResults.shift() ?? [])),
    insert: vi.fn(() => {
      const returning = vi.fn(async () => mutationResults.shift() ?? []);
      const onConflictDoNothing = vi.fn(() => ({ returning }));
      return { values: vi.fn(() => ({ returning, onConflictDoNothing })) };
    }),
    update: vi.fn(() => ({
      set: vi.fn((values: unknown) => ({
        where: vi.fn(async (whereClause: unknown) => {
          updateCalls.push({ values, whereClause });
        }),
      })),
    })),
  };
  return {
    selectResults,
    mutationResults,
    updateCalls,
    db: {
      ...db,
      transaction: vi.fn(async (callback: (transactionDb: typeof db) => unknown) =>
        callback(db),
      ),
    },
  };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return { ...original, db: mocks.db };
});

const { seedPlayers } = await import("./seed-players");

beforeEach(() => {
  mocks.selectResults.length = 0;
  mocks.mutationResults.length = 0;
  mocks.updateCalls.length = 0;
  mocks.db.select.mockClear();
  mocks.db.insert.mockClear();
  mocks.db.update.mockClear();
});

describe("seedPlayers", () => {
  it("creates a player for a legacy name-only balance, locking each session row before writing", async () => {
    const sessions = [
      {
        id: 1,
        playerBalances: [
          { name: "Alice", endingAmount: 100, zhaHuCount: 0, xieXieKaiXiangCount: 0 },
        ],
      },
      {
        id: 2,
        playerBalances: [
          { name: "Bob", playerId: 2, endingAmount: 100, zhaHuCount: 0, xieXieKaiXiangCount: 0 },
        ],
      },
    ];

    mocks.selectResults.push(
      sessions, // bulk sessions read
      [{ id: 2, name: "Bob" }], // existing players
    );
    mocks.mutationResults.push([{ id: 10, name: "Alice" }]); // new player creation
    mocks.selectResults.push(
      [{ id: 2, name: "Bob" }, { id: 10, name: "Alice" }], // refreshed players
      [{ id: 1, playerBalances: sessions[0]!.playerBalances }], // locked read of session 1
      [{ id: 2, playerBalances: sessions[1]!.playerBalances }], // locked read of session 2
    );

    await seedPlayers();

    expect(mocks.db.insert).toHaveBeenCalledTimes(1);
    // Session 1 needed linking (its balance had no playerId); session 2 was
    // already fully linked, so only one of the two locked reads produced a write.
    expect(mocks.updateCalls).toHaveLength(1);
    expect(mocks.updateCalls[0]?.values).toMatchObject({
      playerBalances: [{ name: "Alice", playerId: 10 }],
    });

    const lockedReadCalls = mocks.db.select.mock.results
      .map((result) => result.value)
      .filter((chain) => chain.for.mock.calls.length > 0);
    expect(lockedReadCalls).toHaveLength(2);
  });

  it("performs no writes on a repeat run once every balance is already linked", async () => {
    const sessions = [
      {
        id: 1,
        playerBalances: [
          { name: "Alice", playerId: 10, endingAmount: 100, zhaHuCount: 0, xieXieKaiXiangCount: 0 },
        ],
      },
    ];

    mocks.selectResults.push(
      sessions,
      [{ id: 10, name: "Alice" }], // existing players already include Alice
    );
    mocks.selectResults.push(
      [{ id: 10, name: "Alice" }], // refreshed players
      [{ id: 1, playerBalances: sessions[0]!.playerBalances }], // locked read, unchanged
    );

    await seedPlayers();

    expect(mocks.db.insert).not.toHaveBeenCalled();
    expect(mocks.updateCalls).toHaveLength(0);
  });
});
