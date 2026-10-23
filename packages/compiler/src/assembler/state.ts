// ---------------------------------------------------------------------------
// assembleInitialState — spec catalog + config → initial GameState
//
// Per the catalog module's design (gamedef/src/modules/catalog.ts): every
// piece instance starts in the reserved 'game:unassigned' inventory. Setup
// effects (root flow onEnter hooks — fillDeck/shuffle/distribute for High
// Card) move pieces into their starting inventories when the game begins.
// This assembler does NOT pre-place pieces into deck/hand/etc. — that
// would duplicate what onEnter effects already do declaratively.
//
// Scope note: only 'game' and 'player' scoped inventories are populated
// into GameState (matches the current GameState shape — no team container
// yet, per the 2026-06-14 "no team state scope" decision). 'team' and
// 'piece' scoped inventories are left unhandled until a spec exercises them.
// ---------------------------------------------------------------------------

import type { ModularGameSpec } from "@chaincraft/gamedef";
import { ELIMINATED_PROPERTY } from "@chaincraft/runtime";
import { enumerateCatalogPieces } from "#compiler/assembler/catalog.js";
import type {
  GameConfig,
  GameState,
  Gamepiece,
  InventoryData,
  InventoryStructure,
  PlayerState,
  PropertyConfig,
} from "./types.js";
import { UNASSIGNED_INVENTORY_ID } from "./types.js";

function emptyInventoryData(structure: InventoryStructure): InventoryData {
  switch (structure) {
    case "none":
      return { structure: "none", pieceIds: [] };
    case "stack":
      return { structure: "stack", pieceIds: [] };
    case "line":
      return { structure: "line", slots: [] };
    case "grid":
      return { structure: "grid", order: "row-major", cells: {} };
    case "graph":
      return { structure: "graph", nodes: {} };
  }
}

/** Resolve a state property's declared default into its initial runtime value. */
function resolveDefault(
  prop: PropertyConfig,
  rawDefault: unknown,
  playerCount: number,
): unknown {
  if (prop.computed) return undefined; // computed properties are never stored
  if (
    rawDefault &&
    typeof rawDefault === "object" &&
    "fromPlayerCount" in rawDefault
  ) {
    return playerCount;
  }
  return rawDefault;
}

function assembleGameProperties(
  spec: ModularGameSpec,
  config: GameConfig,
  playerCount: number,
): Record<string, unknown> {
  const props = spec.state?.game?.properties ?? [];
  return Object.fromEntries(
    props.map((p) => [
      p.id,
      resolveDefault(config.gameProperties[p.id], p.default, playerCount),
    ]),
  );
}

function assemblePlayerProperties(
  spec: ModularGameSpec,
  config: GameConfig,
  playerCount: number,
): Record<string, unknown> {
  const props = spec.state?.player?.properties ?? [];
  return {
    ...Object.fromEntries(
      props.map((p) => [
        p.id,
        resolveDefault(config.playerProperties[p.id], p.default, playerCount),
      ]),
    ),
    [ELIMINATED_PROPERTY]: false,
  };
}

function assembleGameInventories(
  config: GameConfig,
): Record<string, InventoryData> {
  const result: Record<string, InventoryData> = {};
  for (const [id, inv] of Object.entries(config.inventories)) {
    if (inv.scope !== "game") continue;
    result[id] = emptyInventoryData(inv.structure);
  }
  return result;
}

function assemblePlayerInventories(
  config: GameConfig,
): Record<string, InventoryData> {
  const result: Record<string, InventoryData> = {};
  for (const [id, inv] of Object.entries(config.inventories)) {
    if (inv.scope !== "player") continue;
    result[id] = emptyInventoryData(inv.structure);
  }
  return result;
}

/**
 * Instantiate every catalog entry into a Gamepiece. Named pieces (entry.id
 * set) use that id directly; anonymous/quantity pieces get
 * `${typeId}-${n}` with a per-type counter starting at 1, in catalog
 * declaration order. All instances are returned in catalog order for
 * placement into game:unassigned.
 *
 * Property values: declared `default`s from the gamepieceTypes module seed
 * the property bag; catalog `entry.properties` overrides win (this is how
 * immutable per-instance values like a card's `value` are set, since those
 * properties have no `default` at all).
 */
function assembleGamepieces(spec: ModularGameSpec): Record<string, Gamepiece> {
  const typeDefs = spec.gamepieceTypes?.types ?? [];
  const gamepieces: Record<string, Gamepiece> = {};

  for (const { entry, pieceIds } of enumerateCatalogPieces(spec)) {
    const typeDef = typeDefs.find((t) => t.id === entry.typeId);

    for (const id of pieceIds) {
      const properties: Record<string, unknown> = {};
      for (const propDef of typeDef?.properties ?? []) {
        if (propDef.default !== undefined)
          properties[propDef.id] = propDef.default;
      }
      Object.assign(properties, entry.properties ?? {});

      gamepieces[id] = {
        typeId: entry.typeId,
        ownerId: "",
        properties,
        faceUp: false,
        exhausted: false,
        visibleTo: null,
      };
    }
  }

  return gamepieces;
}

/**
 * Assemble the initial GameState from a validated ModularGameSpec and its
 * assembled GameConfig. All catalog pieces start in 'game:unassigned';
 * onEnter setup effects are responsible for moving them into starting
 * inventories once the flow runner begins.
 */
export function assembleInitialState(
  spec: ModularGameSpec,
  config: GameConfig,
  players: string[],
): GameState {
  const gamepieces = assembleGamepieces(spec);

  const gameInventories = assembleGameInventories(config);
  gameInventories[UNASSIGNED_INVENTORY_ID] = {
    structure: "none",
    pieceIds: Object.keys(gamepieces),
  };

  const playerInventoryTemplate = assemblePlayerInventories(config);
  const playersState: Record<string, PlayerState> = Object.fromEntries(
    players.map((pid) => [
      pid,
      {
        roles: [],
        properties: assemblePlayerProperties(spec, config, players.length),
        // Deep-clone per player — each player's inventories are independent instances.
        inventories: Object.fromEntries(
          Object.entries(playerInventoryTemplate).map(([id, data]) => [
            id,
            structuredClone(data),
          ]),
        ),
      },
    ]),
  );

  return {
    gameProperties: assembleGameProperties(spec, config, players.length),
    gameInventories,
    players: playersState,
    gamepieces,
  };
}
