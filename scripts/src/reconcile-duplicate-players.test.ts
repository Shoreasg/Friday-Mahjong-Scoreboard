import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectResults: unknown[] = [];
  const executeResults: unknown[] = [];
  const updateCalls: { table: unknown; values: unknown }[] = [];
  const deleteCalls: { table: unknown; whereClause: unknown }[] = [];

  function selectChain(result: unknown) {
    const chain = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      then: (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(result).then(resolve, reject),
    };
    chain.from.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);
    return chain;
  }

  const db = {
    selectResults,
    executeResults,
    updateCalls,
    deleteCalls,
    execute: vi.fn(async () => executeResults.shift() ?? { rows: [] }),
    select: vi.fn(() => selectChain(selectResults.shift() ?? [])),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: unknown) => ({
        where: vi.fn(async () => {
          updateCalls.push({ table, values });
        }),
      })),
    })),
    delete: vi.fn((table: unknown) => ({
      where: vi.fn(async (whereClause: unknown) => {
        deleteCalls.push({ table, whereClause });
      }),
    })),
  };
  return {
    selectResults,
    executeResults,
    updateCalls,
    deleteCalls,
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

const { playersTable, mahjongSessionsTable } = await import("@workspace/db");
const { reconcileDuplicatePlayers } = await import("./reconcile-duplicate-players");

beforeEach(() => {
  mocks.selectResults.length = 0;
  mocks.executeResults.length = 0;
  mocks.updateCalls.length = 0;
  mocks.deleteCalls.length = 0;
  mocks.db.select.mockClear();
  mocks.db.update.mockClear();
  mocks.db.delete.mockClear();
  mocks.db.transaction.mockClear();
});

describe("reconcileDuplicatePlayers", () => {
  it("skips entirely when the players table does not exist yet", async () => {
    mocks.executeResults.push({ rows: [{ exists: false }] });

    await reconcileDuplicatePlayers();

    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("merges a case/whitespace duplicate into the oldest row, remapping balances and reactivating an active alias", async () => {
    mocks.executeResults.push({ rows: [{ exists: true }] });
    mocks.selectResults.push(
      [
        { id: 1, name: "Tom", active: false },
        { id: 5, name: " tom ", active: true },
      ],
      [
        {
          id: 100,
          playerBalances: [
            { name: " tom ", playerId: 5, endingAmount: 500, zhaHuCount: 0, xieXieKaiXiangCount: 0 },
          ],
        },
      ],
    );

    await reconcileDuplicatePlayers();

    const playerUpdate = mocks.updateCalls.find((call) => call.table === playersTable);
    expect(playerUpdate?.values).toMatchObject({ active: true });

    const sessionUpdate = mocks.updateCalls.find((call) => call.table === mahjongSessionsTable);
    expect(sessionUpdate?.values).toMatchObject({
      playerBalances: [{ name: "Tom", playerId: 1 }],
    });

    expect(mocks.deleteCalls).toEqual([
      expect.objectContaining({ table: playersTable }),
    ]);
  });

  it("performs no writes on a repeat run once no duplicates remain", async () => {
    mocks.executeResults.push({ rows: [{ exists: true }] });
    mocks.selectResults.push([{ id: 1, name: "Tom", active: true }]);

    await reconcileDuplicatePlayers();

    expect(mocks.updateCalls).toHaveLength(0);
    expect(mocks.deleteCalls).toHaveLength(0);
  });
});
