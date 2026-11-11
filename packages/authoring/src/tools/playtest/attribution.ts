// ---------------------------------------------------------------------------
// Attribution of runtime throws during playtest.
//
// Maps an error thrown while a game runs to who has to act on it:
//   spec         — spec content can cause it; the hint names the construct to check
//   engine       — only an engine (or playtest driver) bug can cause it
//   unsupported  — a construct playtest can't run (custom effects, llm/external data)
//   unclassified — not a GameRuntimeError, so the origin is unknown
//
// The runtime tags each fault with a code and origin (GameRuntimeError); this file only adds
// playtest codes and agent-facing hints.
// ---------------------------------------------------------------------------

import { IllegalActionError, isGameRuntimeError } from "@chaincraft/runtime";
import type { FaultCode, FaultCodeOf } from "@chaincraft/runtime";

export type AttributionCategory = "spec" | "engine" | "unsupported" | "unclassified";

export type PlaytestErrorCode =
  | "playtest-no-legal-actions"
  | "playtest-runaway"
  | "playtest-unsupported"
  | "playtest-spec-error"
  | "engine-error"
  | "runtime-error";

export interface Attribution {
  category: AttributionCategory;
  code: PlaytestErrorCode;
  hint: string;
  /** The runtime's fault code, when the error carried one. */
  faultCode?: FaultCode;
}

const ENGINE_HINT =
  "This is an engine bug, not your spec. Report it with the repro; don't change the spec to work around it.";

const ACTOR_HINT_TAIL = "ran from a flow hook, where there is no acting player.";

/** Exhaustive: adding a spec fault code to the runtime fails compilation here until it has a hint. */
const SPEC_HINTS: Record<FaultCodeOf<"spec">, string> = {
  "step-budget-exceeded":
    "A loop keeps running without prompting anyone or ending. Check the loop's endCondition and " +
    "that its children change the state it reads.",
  "no-legal-actions":
    "A player reached a turn with no offered action and no pass. Check the actions' preconditions " +
    "and the turn grammar (allow passing, or end the turn or loop before nothing is playable).",
  "action-unknown": "A turn grammar references an action id that doesn't exist in the actions module.",
  "auto-input-unavailable":
    "`effect-originator` and `trigger-input` inputs are only filled in for reactive actions. Use a " +
    "player-select or gamepiece-select input in a regular action.",
  "from-player-invalid": "`fromPlayer: { param }` must name an earlier player-select input of the same action.",
  "player-target-no-actor":
    `An effect targeting \`actor\` (the default) or \`all-other\` ${ACTOR_HINT_TAIL} ` +
    "Name the players explicitly (`all`, `{ stateRef }`, `{ where }`) or run it from an action.",
  "player-target-param-invalid": "A `{ param }` player target must name a player-select input of the same action.",
  "player-target-stateref-path": "A `{ stateRef }` player target must be `game.property.<id>` or `player.property.<id>`.",
  "player-target-stateref-invalid":
    "The `{ stateRef }` property doesn't hold a player id when the effect runs. Set it before this effect.",
  "player-selector-invalid":
    "A turn's `startingPlayer` or `actor` stateRef property holds a value that isn't a player id. " +
    "Store a player id there (or \"\" for seat 1) before the turn starts.",
  "state-path-unsupported": "Turn-order `stateRef` and loop `writeIterationTo` paths must be `game.property.<id>`.",
  "selector-no-player":
    `A gamepiece selector on a player-scoped inventory ${ACTOR_HINT_TAIL} Add \`player:\` (e.g. \`all\`).`,
  "move-destination-no-player": `A move into a player-scoped inventory ${ACTOR_HINT_TAIL} Add \`to.player\`.`,
  "move-destination-missing":
    "The move's `to.inventory` doesn't exist for the resolved player. Check the inventory id and its scope.",
  "shuffle-inventory-missing":
    "The shuffled inventory doesn't exist for this context. A player-scoped inventory needs an acting " +
    "player, so a flow hook can only shuffle game-scoped inventories.",
  "set-state-invalid-ref":
    "A set-state writes a value that isn't a valid id into a property whose type references players, roles or pieces.",
  "set-state-invalid-path": "A set-state `path` must be `game.property.<id>` or `player.property.<id>`.",
  "inventory-no-room":
    "A move places a piece where there is no room (cell taken, index out of range, inventory full). " +
    "Gate the action with a precondition or input validation so it is only offered when the target has room.",
  "evaluation-inventory-missing": "The dominant-gamepiece `evaluationInventory` must be a game-scoped inventory.",
  "expression-invalid": "An expression in the spec is malformed. Check its syntax and the paths it reads.",
  "expression-path-invalid":
    "An expression path has the wrong shape. Use `<root>.property.<id>` or `<root>.inventory.<id>`.",
  "expression-no-actor":
    `An expression reads \`actor\` but ${ACTOR_HINT_TAIL} ` +
    "Read the player through `players`, an aggregator, or a game property holding the player id.",
  "expression-source-invalid":
    "An effect's `source` must resolve to a piece: a `{ param }` naming an answered gamepiece-select input " +
    "of the same action, or an existing piece `{ id }`. A `{ param }` source can't be used from a flow hook.",
  "expression-not-a-number":
    "A sum() value expression read a non-number for some item. Sum a numeric property, or filter items that lack it. " +
    "If the property is numeric (including a computed property) and this persists, report it with the repro; " +
    "don't rewrite the spec.",
};

const UNSUPPORTED_HINTS: Partial<Record<FaultCodeOf<"host">, string>> = {
  "no-custom-handler": "Playtest can't run `kind: custom` effects; games that reach one stop here. Not a spec defect.",
  "no-system-responder":
    "Playtest can't answer llm or external-data effects; games that reach one stop here. Not a spec defect.",
};

const DEDICATED_CODES: Partial<Record<FaultCode, PlaytestErrorCode>> = {
  "step-budget-exceeded": "playtest-runaway",
  "no-legal-actions": "playtest-no-legal-actions",
};

/** Result for a throw that isn't a GameRuntimeError. */
export const UNCLASSIFIED: Attribution = {
  category: "unclassified",
  code: "runtime-error",
  hint: "Unrecognized runtime error. It may come from the spec or the engine; include the repro if you report it.",
};

/** Classifies an error thrown while a playtest game runs. */
export function attributeError(error: unknown): Attribution {
  // The driver retries rejected generated values itself; an uncaught one means an offered value was rejected.
  if (error instanceof IllegalActionError || (error instanceof Error && error.name === "IllegalActionError")) {
    return { category: "engine", code: "engine-error", hint: ENGINE_HINT };
  }
  if (!isGameRuntimeError(error)) return UNCLASSIFIED;

  const faultCode = error.code;
  switch (error.origin) {
    case "spec":
      return {
        category: "spec",
        code: DEDICATED_CODES[faultCode] ?? "playtest-spec-error",
        hint: SPEC_HINTS[faultCode as FaultCodeOf<"spec">],
        faultCode,
      };
    case "host": {
      const hint = UNSUPPORTED_HINTS[faultCode as FaultCodeOf<"host">];
      // Other host faults are controller misuse by the playtest driver.
      return hint
        ? { category: "unsupported", code: "playtest-unsupported", hint, faultCode }
        : { category: "engine", code: "engine-error", hint: ENGINE_HINT, faultCode };
    }
    case "engine":
      return { category: "engine", code: "engine-error", hint: ENGINE_HINT, faultCode };
  }
}
