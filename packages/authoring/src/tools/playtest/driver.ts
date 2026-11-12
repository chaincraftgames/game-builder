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
} from "@chaincraft/runtime";
import type {
  CompiledGameModule,
  GameEvent,
  GameOutcome,
  InputOption,
  NumberInputType,
  PlayerInputSuspension,
  RngProvider,
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
}

/** What the engine offered at an action-select prompt. */
export interface OfferedActions {
  actions: string[];
  canPass: boolean;
}

/** One entry in the game transcript. */
export type TranscriptEntry =
  | {
      kind: "decision";
      playerId: string;
      inputId: string;
      value: unknown;
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
      /** The prompt playtest couldn't answer, for `playtest-unsupported` raised by the driver. */
      input?: { playerId: string; inputId: string };
    };

/** The outcome of a single playtest game. */
export interface GameResult {
  gameSeed: number;
  policySeed: number;
  players: string[];
  /** Responses applied (rejected retries excluded). */
  decisions: number;
  transcript: TranscriptEntry[];
  end: GameEnd;
}

/** A single choice made by the playtest. */
type Choice = { value: unknown; generated: boolean };

/** Plays one game to completion, an error, or `maxDecisions`. */
export async function playGame(options: GameOptions): Promise<GameResult> {
  const { module, players, gameSeed, policySeed, maxDecisions } = options;
  const rng = createSeededRng(policySeed);
  const transcript: TranscriptEntry[] = [];
  let decisions = 0;

  const controller = new GameController(module, {
    events: { onEngineEvent: (event) => record(transcript, event) },
  });

  const result = (end: GameEnd): GameResult => ({
    gameSeed,
    policySeed,
    players,
    decisions,
    transcript,
    end,
  });
  const failure = (
    attribution: Attribution,
    message: string,
    extra: { nodeId?: string; input?: { playerId: string; inputId: string } } = {},
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
      attribution.faultCode === "step-budget-exceeded" && typeof nodeId === "string" ? { nodeId } : {},
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
        try {
          await controller.processAction({ playerId, value: choice.value });
          applied = true;
        } catch (error) {
          if (!isIllegalActionError(error)) throw error;
          // An offered value was rejected: keep it in the transcript as the last decision.
          if (!choice.generated) return thrown(error);
          // All-or-nothing: a rejected answer changed no state and fired no events.
          transcript.pop();
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

  return result({ kind: "complete", outcome: controller.outcome! });
}

function record(transcript: TranscriptEntry[], event: GameEvent): void {
  switch (event.kind) {
    case "message:emit":
      transcript.push({
        kind: "message",
        recipients: [...event.message.recipients],
        content: event.message.content,
      });
      break;
    case "turn:start":
    case "turn:end":
      transcript.push({
        kind: event.kind,
        nodeId: event.nodeId,
        actors: [...event.actors],
      });
      break;
    case "flow:enter":
      transcript.push({
        kind: "flow:enter",
        nodeId: event.nodeId,
        nodeType: event.nodeType,
      });
      break;
    case "action:start":
      transcript.push({
        kind: "action:start",
        playerId: event.playerId,
        actionId: event.actionId,
        auto: event.auto,
      });
      break;
    case "action:forfeit":
      transcript.push({
        kind: "action:forfeit",
        playerId: event.playerId,
        inputId: event.inputId,
        ...(event.actionId !== undefined && { actionId: event.actionId }),
      });
      break;
    case "passive:fire":
      transcript.push({
        kind: "passive:fire",
        passiveId: event.passiveId,
        ...(event.ownerPieceId !== undefined && {
          ownerPieceId: event.ownerPieceId,
        }),
      });
      break;
    case "game:complete":
      transcript.push({
        kind: "complete",
        reason: event.outcome.reason,
        ...(event.outcome.winnerIds !== undefined && {
          winnerIds: [...event.outcome.winnerIds],
        }),
      });
      break;
    default:
      break;
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
    hint: "Playtest limitation, not a spec defect; games that reach it stop here.",
  };
}
