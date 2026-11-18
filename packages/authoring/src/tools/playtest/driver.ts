// ---------------------------------------------------------------------------
// Playtest driver — plays one seeded game with a uniformly random legal player.
//
// Pure: no fs, no console. The policy only chooses what the engine offers (action-select
// actions, pass, prompt options); it never models legality itself. For inputs with no
// option list it generates a value from the input type and retries if the engine rejects it.
// ---------------------------------------------------------------------------

import {
  createSeededRng,
  GameController,
  GameRuntimeError,
  getGameState,
  getPlayerState,
  isGameRuntimeError,
} from "@chaincraft/runtime";
import type {
  CompiledGameModule,
  FaultSite,
  GameEvent,
  GameOutcome,
  GameSession,
  InputOption,
  InventoryData,
  NumberInputType,
  PlayerInputSuspension,
  ProjectedInventory,
  PropertyConfig,
  RngProvider,
  StateChangeEvent,
} from "@chaincraft/runtime";
import {
  attributeError,
  ENGINE_HINT,
  isIllegalActionError,
} from "#authoring/tools/playtest/attribution.js";
import type { Attribution } from "#authoring/tools/playtest/attribution.js";

/** How many new values are tried after the engine rejects a generated one. */
export const MAX_GENERATED_RETRIES = 10;

/** The options for a single playtest game. */
export interface GameOptions {
  module: CompiledGameModule;
  /** Player ids in seat order, e.g. `["p1", "p2"]`. */
  players: string[];
  /** Seeds the game's own RNG (shuffles, dice). */
  gameSeed: number;
  /** Seeds the random player; independent of the game RNG. */
  policySeed: number;
  /** Responses after which an unfinished game is stopped. */
  maxDecisions: number;
  /** Also record what this player could see; the game itself is unaffected. */
  viewer?: string;
}

/** What the engine offered at an action-select prompt. */
export interface OfferedActions {
  actions: string[];
  canPass: boolean;
  /** Per offered action, how many choices its first input has; absent when it has no finite list. */
  choiceCounts?: Record<string, number>;
}

/** One entry in the game transcript. */
export type TranscriptEntry =
  | {
      kind: "decision";
      playerId: string;
      inputId: string;
      value: unknown;
      /** The answer is a secret of another player; `value` is not meaningful. Viewer transcripts only. */
      hidden?: true;
      /** Node of the active turn when the player answered. */
      turnNodeId?: string;
      /** Present for action-select prompts only. */
      offered?: OfferedActions;
      /** Present for prompts with a finite option list; absent when the value was generated. */
      options?: InputOption[];
    }
  | { kind: "message"; recipients: string[]; content: string }
  | { kind: "turn:start"; nodeId: string; actors: string[] }
  | { kind: "turn:end"; nodeId: string; actors: string[] }
  | { kind: "flow:enter"; nodeId: string; nodeType: string }
  | { kind: "action:start"; playerId: string; actionId: string; auto: boolean }
  | {
      kind: "action:forfeit";
      playerId: string;
      actionId?: string;
      inputId: string;
    }
  | { kind: "passive:fire"; passiveId: string; ownerPieceId?: string }
  | { kind: "change"; change: StateChangeEvent }
  | { kind: "complete"; winnerIds?: string[]; reason: string };

/** The possible ways a game can end. */
export type GameEnd =
  | { kind: "complete"; outcome: GameOutcome }
  | { kind: "max-decisions" }
  | {
      kind: "error";
      attribution: Attribution;
      message: string;
      /** Node of the active turn when the game stopped. */
      turnNodeId?: string;
      /** Innermost flow node, for a step-budget fault. */
      nodeId?: string;
      /** Where the runtime says the faulting effect ran; absent for faults outside effect execution. */
      site?: FaultSite;
      /** The prompt playtest couldn't answer, for `playtest-unsupported` raised by the driver. */
      input?: { playerId: string; inputId: string };
    };

/** A game's or player's properties and how many pieces each inventory held (`"hidden"`: not even the count is visible). */
export interface StateSummary {
  properties: Record<string, unknown>;
  inventories: Record<string, number | "hidden">;
}

/** The state a completed game ended in. */
export interface FinalState {
  game: StateSummary;
  players: Record<string, StateSummary>;
}

/** The outcome of a single playtest game. */
export interface GameResult {
  gameSeed: number;
  policySeed: number;
  players: string[];
  /** Responses applied (rejected retries excluded). */
  decisions: number;
  transcript: TranscriptEntry[];
  end: GameEnd;
  /** Present when the game completed. */
  final?: FinalState;
  /** The game as `viewer` saw it; present when a viewer was requested. */
  view?: { viewer: string; transcript: TranscriptEntry[]; final?: FinalState };
}

/** A single choice made by the playtest. */
type Choice = { value: unknown; generated: boolean };

/** Plays one game to completion, an error, or `maxDecisions`. */
export async function playGame(options: GameOptions): Promise<GameResult> {
  const { module, players, gameSeed, policySeed, maxDecisions, viewer } = options;
  const rng = createSeededRng(policySeed);
  const transcript: TranscriptEntry[] = [];
  const viewTranscript: TranscriptEntry[] = [];
  let decisions = 0;

  // The controller only exposes raw stored state, which omits computed properties.
  let session: GameSession | undefined;
  const controller = new GameController(
    {
      ...module,
      createSession: (...args) => (session = module.createSession(...args)),
    },
    {
      events: {
        onEngineEvent: (event) => {
          const entry = toEntry(event);
          if (entry === undefined) return;
          transcript.push(entry);
          // Projected now: what a change reveals depends on the state at this moment.
          const seen = viewer === undefined ? undefined : viewOf(entry, viewer, controller);
          if (seen) viewTranscript.push(seen);
        },
      },
    },
  );

  const result = (end: GameEnd): GameResult => ({
    gameSeed,
    policySeed,
    players,
    decisions,
    transcript,
    end,
    ...(viewer !== undefined && { view: { viewer, transcript: viewTranscript } }),
  });
  const failure = (
    attribution: Attribution,
    message: string,
    extra: { nodeId?: string; site?: FaultSite; input?: { playerId: string; inputId: string } } = {},
  ): GameResult =>
    result({
      kind: "error",
      attribution,
      message,
      turnNodeId: controller.currentTurn?.nodeId,
      ...extra,
    });
  const thrown = (error: unknown): GameResult => {
    const attribution = attributeError(error);
    const nodeId = (error as { nodeId?: unknown } | undefined)?.nodeId;
    return failure(
      attribution,
      error instanceof Error ? error.message : String(error),
      {
        ...(attribution.faultCode === "step-budget-exceeded" && typeof nodeId === "string" && { nodeId }),
        ...(isGameRuntimeError(error) && error.site !== undefined && { site: error.site }),
      },
    );
  };

  try {
    await controller.init(`playtest-${gameSeed}`, players, { seed: gameSeed });

    while (!controller.isComplete) {
      if (decisions >= maxDecisions) return result({ kind: "max-decisions" });

      const prompts = [...controller.pendingPrompts.values()];
      if (prompts.length === 0) {
        return failure(
          engineAttribution(),
          "the game is neither complete nor waiting for a player",
        );
      }
      const prompt = prompts[Math.floor(rng.nextFloat() * prompts.length)];
      const playerId = prompt.awaiting;

      const entry: TranscriptEntry = {
        kind: "decision",
        playerId,
        inputId: prompt.input.id,
        value: undefined,
        turnNodeId: controller.currentTurn?.nodeId,
        ...(prompt.input.type.kind === "action-select" && {
          offered: {
            actions: [...prompt.input.type.actions],
            canPass: prompt.input.type.canPass,
            choiceCounts: choiceCounts(controller, playerId, prompt.input.type.actions),
          },
        }),
        ...(prompt.options !== undefined && { options: [...prompt.options] }),
      };

      let applied = false;
      for (let attempt = 0; !applied; attempt++) {
        const choice = choose(prompt, rng);
        if ("unsupported" in choice) {
          return failure(unsupportedAttribution(), choice.unsupported, {
            input: { playerId, inputId: prompt.input.id },
          });
        }
        entry.value = choice.value;
        // Recorded first so the events the response causes follow it.
        transcript.push(entry);
        if (viewer !== undefined) viewTranscript.push(viewOf(entry, viewer, controller)!);
        try {
          await controller.processAction({ playerId, value: choice.value });
          applied = true;
        } catch (error) {
          if (!isIllegalActionError(error)) throw error;
          // An offered value was rejected: keep it in the transcript as the last decision.
          if (!choice.generated) return thrown(error);
          // All-or-nothing: a rejected answer changed no state and fired no events.
          transcript.pop();
          if (viewer !== undefined) viewTranscript.pop();
          if (attempt >= MAX_GENERATED_RETRIES) {
            const message = `playtest couldn't find an accepted value for input "${prompt.input.id}"`;
            return failure(unsupportedAttribution(), message, {
              input: { playerId, inputId: prompt.input.id },
            });
          }
        }
      }
      decisions++;
    }
  } catch (error) {
    return thrown(error);
  }

  const complete = result({ kind: "complete", outcome: controller.outcome! });
  return {
    ...complete,
    final: finalState(session!),
    ...(complete.view && {
      view: { ...complete.view, final: viewFinalState(controller, session!, complete.view.viewer) },
    }),
  };
}

/** What `viewer` can see of an entry, or `undefined` when nothing. Decisions and messages of others are cut down. */
function viewOf(
  entry: TranscriptEntry,
  viewer: string,
  controller: GameController,
): TranscriptEntry | undefined {
  switch (entry.kind) {
    case "message":
      return entry.recipients.includes(viewer) ? entry : undefined;
    case "change": {
      const [seen] = controller.projectStateChangesForPlayer([entry.change], viewer);
      return seen === undefined ? undefined : { kind: "change", change: seen };
    }
    case "decision": {
      if (entry.playerId === viewer) return { ...entry };
      // Which action was chosen is public (it starts for everyone); the answers to its inputs are not.
      if (entry.offered !== undefined) {
        const { offered: _offered, options: _options, ...rest } = entry;
        return rest;
      }
      const { options: _options, ...rest } = entry;
      return { ...rest, value: null, hidden: true };
    }
    default:
      return entry;
  }
}

/** The final state as `viewer` could read it. */
function viewFinalState(
  controller: GameController,
  session: GameSession,
  viewer: string,
): FinalState {
  const projected = controller.projectStateForPlayer(viewer);
  const counts = (inventories: Record<string, ProjectedInventory>): StateSummary["inventories"] =>
    Object.fromEntries(
      Object.entries(inventories).map(([id, inv]) => [
        id,
        !("redacted" in inv) ? pieceCount(inv) : inv.redacted === "hidden" ? "hidden" : inv.count,
      ]),
    );
  // The runtime projection omits computed properties, so apply the common rules here: shown unless private to another player.
  const computed = (configs: Record<string, PropertyConfig>, owner?: string) =>
    Object.entries(configs)
      .filter(([, config]) => config.computed)
      .filter(([, config]) => config.visibility === undefined || config.visibility === "public" || owner === viewer)
      .map(([key]) => key);
  const gameComputed = getGameState(session) as Record<string, unknown>;
  return {
    game: {
      properties: {
        ...projected.gameProperties,
        ...Object.fromEntries(computed(session.config.gameProperties).map((key) => [key, gameComputed[key]])),
      },
      inventories: counts(projected.gameInventories),
    },
    players: Object.fromEntries(
      Object.entries(projected.players).map(([id, player]) => {
        const own = getPlayerState(session, id) as Record<string, unknown>;
        return [
          id,
          {
            properties: {
              ...player.properties,
              ...Object.fromEntries(computed(session.config.playerProperties, id).map((key) => [key, own[key]])),
            },
            inventories: counts(player.inventories),
          },
        ];
      }),
    ),
  };
}

/** How many choices each action's first input offers, without taking the action. */
function choiceCounts(
  controller: GameController,
  playerId: string,
  actions: readonly string[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const actionId of actions) {
    const walk = controller.queryResponses(playerId, [{ kind: "act", actionId }]);
    if (walk.kind === "ok" && typeof walk.next === "object" && walk.next.options !== undefined)
      counts[actionId] = walk.next.options.length;
  }
  return counts;
}

function finalState(session: GameSession): FinalState {
  const { state } = session;
  const summarize = (
    properties: Record<string, unknown>,
    inventories: Record<string, InventoryData>,
  ): StateSummary => ({
    properties,
    inventories: Object.fromEntries(
      Object.entries(inventories).map(([id, data]) => [id, pieceCount(data)]),
    ),
  });
  return {
    game: summarize({ ...getGameState(session) }, state.gameInventories),
    players: Object.fromEntries(
      Object.entries(state.players).map(([id, p]) => [
        id,
        summarize({ ...getPlayerState(session, id) }, p.inventories),
      ]),
    ),
  };
}

function pieceCount(data: InventoryData): number {
  const occupied = (slots: Iterable<string | null>) =>
    [...slots].filter((id) => id !== null).length;
  switch (data.structure) {
    case "none":
    case "stack":
      return data.pieceIds.length;
    case "line":
      return occupied(data.slots);
    case "grid":
      return occupied(Object.values(data.cells));
    case "graph":
      return occupied(Object.values(data.nodes));
  }
}

/** The transcript entry for an engine event; `undefined` for events the transcript doesn't keep. */
function toEntry(event: GameEvent): TranscriptEntry | undefined {
  switch (event.kind) {
    case "message:emit":
      return {
        kind: "message",
        recipients: [...event.message.recipients],
        content: event.message.content,
      };
    case "turn:start":
    case "turn:end":
      return {
        kind: event.kind,
        nodeId: event.nodeId,
        actors: [...event.actors],
      };
    case "flow:enter":
      return {
        kind: "flow:enter",
        nodeId: event.nodeId,
        nodeType: event.nodeType,
      };
    case "action:start":
      return {
        kind: "action:start",
        playerId: event.playerId,
        actionId: event.actionId,
        auto: event.auto,
      };
    case "action:forfeit":
      return {
        kind: "action:forfeit",
        playerId: event.playerId,
        inputId: event.inputId,
        ...(event.actionId !== undefined && { actionId: event.actionId }),
      };
    case "passive:fire":
      return {
        kind: "passive:fire",
        passiveId: event.passiveId,
        ...(event.ownerPieceId !== undefined && {
          ownerPieceId: event.ownerPieceId,
        }),
      };
    case "state:change":
      // Cloned: values may reference state that later effects mutate.
      return { kind: "change", change: structuredClone(event.change) };
    case "game:complete":
      return {
        kind: "complete",
        reason: event.outcome.reason,
        ...(event.outcome.winnerIds !== undefined && {
          winnerIds: [...event.outcome.winnerIds],
        }),
      };
    default:
      return undefined;
  }
}

function pick<T>(items: readonly T[], rng: RngProvider): T {
  return items[Math.floor(rng.nextFloat() * items.length)];
}

/** An offered value, a generated one, or the reason none can be generated. */
function choose(
  prompt: PlayerInputSuspension,
  rng: RngProvider,
): Choice | { unsupported: string } {
  const { input, options } = prompt;
  const type = input.type;

  if (type.kind === "action-select") {
    const choices: unknown[] = type.actions.map((actionId) => ({
      kind: "act",
      actionId,
    }));
    if (type.canPass) choices.push({ kind: "pass" });
    if (choices.length === 0) {
      throw new GameRuntimeError(
        "input-no-options",
        `Action-select for "${prompt.awaiting}" offers no action and no pass`,
      );
    }
    return { value: pick(choices, rng), generated: false };
  }

  if (options !== undefined) {
    if (options.length === 0) {
      throw new GameRuntimeError(
        "input-no-options",
        `Input "${input.id}" was offered to "${prompt.awaiting}" with no options`,
      );
    }
    return { value: pick(options, rng), generated: false };
  }

  switch (type.kind) {
    case "number":
      return { value: generateNumber(type, rng), generated: true };
    case "string":
      return { value: "playtest", generated: true };
    default:
      return {
        unsupported: `playtest can't generate a value for input "${input.id}" (kind "${type.kind}")`,
      };
  }
}

/** Bounded: uniform in range. One bound: 10 wide on the open side. Neither: 0 to 10. */
function generateNumber(type: NumberInputType, rng: RngProvider): number {
  const low = type.min ?? (type.max !== undefined ? type.max - 10 : 0);
  const high = type.max ?? low + 10;
  if (type.integer === false) return low + rng.nextFloat() * (high - low);
  const first = Math.ceil(low);
  const last = Math.floor(high);
  return last < first
    ? first
    : first + Math.floor(rng.nextFloat() * (last - first + 1));
}

function engineAttribution(): Attribution {
  return { category: "engine", code: "engine-error", hint: ENGINE_HINT };
}

function unsupportedAttribution(): Attribution {
  return {
    category: "unsupported",
    code: "playtest-unsupported",
    hint:
      "Playtest couldn't generate a value this input accepts. If the input's validation can reject " +
      "every value, fix the validation; otherwise this is a playtest limitation, not a spec defect.",
  };
}
