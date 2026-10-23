// ---------------------------------------------------------------------------
// Passives integration test — lifesteal and thorns (board-battler spec).
//
// Strategy: compile the spec, create a session, manually place the passive
// carrier in the enabledIn inventory, then drive a single executor call.
// Only the relevant passive carrier is placed on the field per test so
// passive chains don't interfere with each other's assertions.
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { load } from "js-yaml";
import { validate } from "@chaincraft/gamedef/validator";
import { executeSetState, executeUpdate } from "@chaincraft/runtime";
import type { GameSession, BagInventoryData } from "@chaincraft/runtime";
import { assembleModule } from "../index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadSpec(
  filename: string,
  mutate?: (raw: Record<string, unknown>) => void,
) {
  const raw = load(
    readFileSync(
      join(__dirname, "../../../../gamedef/examples/", filename),
      "utf-8",
    ),
  ) as Record<string, unknown>;
  mutate?.(raw);
  const result = validate(raw);
  if (!result.valid) {
    throw new Error(
      `${filename} failed validation: ${JSON.stringify(result.errors, null, 2)}`,
    );
  }
  return result.spec;
}

function life(session: GameSession, playerId: string): number {
  return Number(session.state.players[playerId].properties["life"] ?? 0);
}

/** Move a piece from game:unassigned to a player's field inventory. */
function placeOnField(
  session: GameSession,
  pieceId: string,
  playerId: string,
): void {
  const unassigned = session.state.gameInventories[
    "game:unassigned"
  ] as BagInventoryData;
  unassigned.pieceIds = unassigned.pieceIds.filter((id) => id !== pieceId);
  session.state.gamepieces[pieceId].ownerId = playerId;
  (
    session.state.players[playerId].inventories["field"] as BagInventoryData
  ).pieceIds.push(pieceId);
}

// ---------------------------------------------------------------------------

describe("Passives — lifesteal and thorns (board-battler)", () => {
  const PLAYERS = ["alice", "bob"];

  let session: GameSession;

  beforeEach(() => {
    const spec = loadSpec("board-battler.yaml");
    const mod = assembleModule(spec, "board-battler");
    session = mod.createSession("passive-test", PLAYERS);
  });

  // -------------------------------------------------------------------------

  it("lifesteal: when the holder deals damage, the holder heals +2", async () => {
    // bloodHunter carries lifesteal; enabledIn: [field]
    placeOnField(session, "bloodHunter", "alice");
    // Start alice below max so the +2 heal is observable
    session.state.players["alice"].properties["life"] = 20;

    const aliceBefore = life(session, "alice"); // 20
    const bobBefore = life(session, "bob"); // 30

    // Alice attacks Bob: decrease Bob's life, actorId = alice → lifesteal fires
    await executeSetState(session, {
      actorId: "alice",
      effectDef: {
        kind: "set-state",
        path: "player.property.life",
        value: { delta: -5 },
        target: { kind: "all-other" },
      },
      actionInputs: {},
    });

    expect(life(session, "bob")).toBe(bobBefore - 5); // damage landed
    expect(life(session, "alice")).toBe(aliceBefore + 2); // lifesteal healed +2
  });

  // -------------------------------------------------------------------------

  it("thorns: when the holder is targeted, the attacker takes 2 damage", async () => {
    // thornBeast carries thorns; enabledIn: [field]
    placeOnField(session, "thornBeast", "bob");

    const aliceBefore = life(session, "alice"); // 30

    // Alice attacks thornBeast's defense; actorId = alice → thorns fires, damages alice
    await executeUpdate(session, {
      actorId: "alice",
      effectDef: {
        kind: "update",
        pieces: {
          player: { param: "defenderOwner" },
          inventory: "field",
          select: { id: { param: "defender" } },
        },
        property: "defense",
        value: { delta: -2 },
      },
      actionInputs: {
        defenderOwner: "bob",
        defender: "thornBeast",
      },
    });

    expect(life(session, "alice")).toBe(aliceBefore - 2); // thorns dealt 2 to the attacker
  });
});

// ---------------------------------------------------------------------------
// Trigger context — passives that read the triggering write and source piece.
// board-battler's passives use flat amounts by design; these tests swap the
// passive effect values in-memory before validation to exercise trigger.* and
// source.property.* inside passive effects.
// ---------------------------------------------------------------------------

type PassiveDef = { id: string; effects: { value: unknown }[] };

function setPassiveValue(
  raw: Record<string, unknown>,
  passiveId: string,
  value: unknown,
): void {
  const effects = raw.effects as { passives: PassiveDef[] };
  const passive = effects.passives.find((p) => p.id === passiveId);
  if (!passive) throw new Error(`passive ${passiveId} not found`);
  passive.effects[0].value = value;
}

describe("Passives — trigger context and source piece", () => {
  const PLAYERS = ["alice", "bob"];

  function makeSession(
    mutate: (raw: Record<string, unknown>) => void,
  ): GameSession {
    const spec = loadSpec("board-battler.yaml", mutate);
    const mod = assembleModule(spec, "board-battler");
    return mod.createSession("passive-trigger-test", PLAYERS);
  }

  it("proportional lifesteal via { var: trigger.delta, negate }: heals exactly the damage dealt", async () => {
    const session = makeSession((raw) =>
      setPassiveValue(raw, "lifesteal", {
        delta: { var: "trigger.delta", negate: true },
      }),
    );
    placeOnField(session, "bloodHunter", "alice");
    session.state.players["alice"].properties["life"] = 20;
    const bobBefore = life(session, "bob");

    await executeSetState(session, {
      actorId: "alice",
      effectDef: {
        kind: "set-state",
        path: "player.property.life",
        value: { delta: -7 },
        target: { kind: "all-other" },
      },
      actionInputs: {},
    });

    expect(life(session, "bob")).toBe(bobBefore - 7);
    expect(life(session, "alice")).toBe(27); // healed exactly 7
  });

  it("proportional lifesteal via { expr }: trigger.* is available to compiled expressions", async () => {
    const session = makeSession((raw) =>
      setPassiveValue(raw, "lifesteal", {
        delta: { expr: "0 - trigger.delta" },
      }),
    );
    placeOnField(session, "bloodHunter", "alice");
    session.state.players["alice"].properties["life"] = 20;

    await executeSetState(session, {
      actorId: "alice",
      effectDef: {
        kind: "set-state",
        path: "player.property.life",
        value: { delta: -4 },
        target: { kind: "all-other" },
      },
      actionInputs: {},
    });

    expect(life(session, "alice")).toBe(24);
  });

  it("trigger.delta reflects the post-clamp write, not the requested delta", async () => {
    const session = makeSession((raw) =>
      setPassiveValue(raw, "lifesteal", {
        delta: { var: "trigger.delta", negate: true },
      }),
    );
    placeOnField(session, "bloodHunter", "alice");
    session.state.players["alice"].properties["life"] = 10;
    session.state.players["bob"].properties["life"] = 3;

    // life has min 0 — a -10 hit on 3 life only removes 3
    await executeSetState(session, {
      actorId: "alice",
      effectDef: {
        kind: "set-state",
        path: "player.property.life",
        value: { delta: -10 },
        target: { kind: "all-other" },
      },
      actionInputs: {},
    });

    expect(life(session, "bob")).toBe(0);
    expect(life(session, "alice")).toBe(13); // healed 3, not 10
  });

  it("thorns reading source.property.power: attacker takes damage equal to its own power", async () => {
    const session = makeSession((raw) =>
      setPassiveValue(raw, "thorns", {
        delta: { var: "source.property.power", negate: true },
      }),
    );
    placeOnField(session, "thornBeast", "bob");
    placeOnField(session, "swiftFang", "alice"); // power 4
    const aliceBefore = life(session, "alice");

    await executeUpdate(session, {
      actorId: "alice",
      effectDef: {
        kind: "update",
        pieces: {
          player: { param: "defenderOwner" },
          inventory: "field",
          select: { id: { param: "defender" } },
        },
        property: "defense",
        value: { delta: -1 },
        source: { param: "attacker" },
      },
      actionInputs: {
        defenderOwner: "bob",
        defender: "thornBeast",
        attacker: "swiftFang",
      },
    });

    expect(life(session, "alice")).toBe(aliceBefore - 4);
  });

  it("thorns reading trigger.delta on a gamepiece write: reflects the defense lost", async () => {
    const session = makeSession((raw) =>
      setPassiveValue(raw, "thorns", { delta: { var: "trigger.delta" } }),
    );
    placeOnField(session, "thornBeast", "bob");
    const aliceBefore = life(session, "alice");

    await executeUpdate(session, {
      actorId: "alice",
      effectDef: {
        kind: "update",
        pieces: {
          player: { param: "defenderOwner" },
          inventory: "field",
          select: { id: { param: "defender" } },
        },
        property: "defense",
        value: { delta: -3 },
      },
      actionInputs: { defenderOwner: "bob", defender: "thornBeast" },
    });

    expect(life(session, "alice")).toBe(aliceBefore - 3);
  });
});
