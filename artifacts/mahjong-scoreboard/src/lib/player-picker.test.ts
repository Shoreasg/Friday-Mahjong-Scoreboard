import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { playerPickerOptions } from "./player-picker.ts";

const roster = [
  { id: 1, name: "Kah Wei", active: true },
  { id: 2, name: "Wei Lun", active: true },
  { id: 3, name: "Ash", active: true },
  { id: 4, name: "One-off Guest", active: false },
];

function names(players: { name: string }[]) {
  return players.map((player) => player.name);
}

describe("player picker options", () => {
  it("lists active players alphabetically, filtered case-insensitively by typed text", () => {
    assert.deepEqual(names(playerPickerOptions(roster, "", new Set(), undefined).players), [
      "Ash",
      "Kah Wei",
      "Wei Lun",
    ]);
    assert.deepEqual(names(playerPickerOptions(roster, "  WEI", new Set(), undefined).players), [
      "Kah Wei",
      "Wei Lun",
    ]);
  });

  it("hides players chosen for another seat and explains an exact match", () => {
    const options = playerPickerOptions(roster, "ash", new Set([3]), undefined);

    assert.deepEqual(options.players, []);
    assert.equal(options.newPlayerName, null);
    assert.deepEqual(options.unavailableMatch, { player: roster[2], reason: "seated" });
  });

  it("hides inactive players, but keeps a seat's existing inactive player", () => {
    const hidden = playerPickerOptions(roster, "guest", new Set(), undefined);
    assert.deepEqual(hidden.players, []);
    assert.equal(hidden.unavailableMatch, null);

    const kept = playerPickerOptions(roster, "", new Set(), 4);
    assert.ok(names(kept.players).includes("One-off Guest"));
  });

  it("offers to create a player only when no existing player has the typed name", () => {
    assert.equal(
      playerPickerOptions(roster, "  Dong ", new Set(), undefined).newPlayerName,
      "Dong",
    );
    assert.equal(playerPickerOptions(roster, "kah wei", new Set(), undefined).newPlayerName, null);

    const inactive = playerPickerOptions(roster, "one-off guest", new Set(), undefined);
    assert.equal(inactive.newPlayerName, null);
    assert.deepEqual(inactive.unavailableMatch, { player: roster[3], reason: "inactive" });
  });
});
