// ---------------------------------------------------------------------------
// Phase 4 — Flow assembler
//
// Converts a gamedef FlowModule (YAML-parsed) into the runtime FlowNode tree.
// Inline effects in hooks are normalized to { ref } entries and added to the
// effectDefs accumulator (same pattern as Phase 3 actions assembler).
//
// Vocabulary translation (anything else throws "not yet supported"):
//   actor 'all' + no turnOrder                    → 'round-robin' from seat 1
//   actor 'all' + seat clockwise                  → 'round-robin' (+ start)
//   actor { player: selector } (no turnOrder)     → 'single'
//   player selectors: 'first' (startingPlayer only), { stateRef } without offset
//
//   gamedef TurnGrammarNode.kind   →  runtime Grammar.kind
//   'action'   → ActionGrammar   (passthrough)
//   'choice'   → ChoiceGrammar   (extracts action refs from options)
//   'sequence' → SequenceGrammar (extracts action refs from steps)
//   'repeat'   → RepeatGrammar   (body recursed)
//   'slot'     → not yet supported
// ---------------------------------------------------------------------------

import type {
  ModularGameSpec,
  EffectCall,
  WinCondition,
} from "@chaincraft/gamedef";
import type {
  FlowNode,
  GameFlowNode,
  LoopFlowNode,
  TurnFlowNode,
  TurnOrdering,
  PlayerSelector,
  Grammar,
  FlowHooks,
  EffectRef,
  WinConditionDef,
  GameSession,
} from "@chaincraft/runtime";
import { normalizeEffectList } from "#compiler/assembler/effects.js";
import { compileFailure } from "#compiler/assembler/errors.js";
import {
  isActionNode,
  isSupportedActor,
  isSupportedFlowKind,
  isSupportedGrammarKind,
  isSupportedInterruptWindows,
  isSupportedLoopEnd,
  isSupportedPick,
  isSupportedPlayerSelector,
  isSupportedRepeatBody,
  isSupportedTimeLimit,
  isSupportedTurnOrder,
  isSupportedWinRule,
} from "#compiler/assembler/support.js";
import { CompileCode } from "#compiler/assembler/types.js";
import { sessionToEvalContext, compilePlayerFilter } from "#compiler/expressions/eval-bridge.js";
import { compilePredicate } from "#compiler/expressions/index.js";
import type {
  ActorSpec,
  TurnOrder,
  TurnGrammarNode,
  FlowNode as GamedefFlowNode,
  PlayerSelector as SpecPlayerSelector,
} from "@chaincraft/gamedef";

// ---------------------------------------------------------------------------
// Hook conversion
// ---------------------------------------------------------------------------

/**
 * Convert a gamedef EffectCall array into runtime EffectRef[] + populate effectDefs.
 * This function will convert inline effects into synthetic IDs and add them to the
 * effectDefs accumulator.
 */
function assembleHooks(
  calls: EffectCall[] | undefined,
  nodeId: string,
  hookName: "onEnter" | "onComplete",
  effectDefs: Record<string, Record<string, unknown>>,
): EffectRef[] | undefined {
  if (!calls?.length) return undefined;

  return normalizeEffectList(calls, `${nodeId}.${hookName}`, effectDefs);
}

/**
 * Convert a gamedef FlowNode hooks object into runtime FlowHooks + populate effectDefs.
 */
function assembleFlowHooks(
  // node.hooks is typed as _FlowHooks (unknown arrays) in the gamedef FlowNode
  // type alias — a workaround for a Zod circular-type constraint. The runtime
  // values are always EffectCall[], so the cast here is safe.
  hooks: { onEnter?: unknown; onComplete?: unknown } | undefined,
  nodeId: string,
  effectDefs: Record<string, Record<string, unknown>>,
): FlowHooks | undefined {
  if (!hooks) return undefined;
  const onEnter = assembleHooks(
    hooks.onEnter as EffectCall[] | undefined,
    nodeId,
    "onEnter",
    effectDefs,
  );
  const onComplete = assembleHooks(
    hooks.onComplete as EffectCall[] | undefined,
    nodeId,
    "onComplete",
    effectDefs,
  );
  if (!onEnter && !onComplete) return undefined;
  return {
    ...(onEnter && { onEnter }),
    ...(onComplete && { onComplete }),
  };
}

// ---------------------------------------------------------------------------
// TurnOrdering mapping
// ---------------------------------------------------------------------------

function unsupported(what: string): never {
  throw new Error(`flow assembler: ${what} is not yet supported.`);
}

function assembleTurnOrdering(
  actor: ActorSpec,
  turnOrder: TurnOrder | undefined,
  path: string,
): TurnOrdering {
  if (typeof actor === "object" && "player" in actor) {
    if (turnOrder) {
      throw compileFailure(
        CompileCode.InvalidSpec,
        "flow assembler: actor { player } selects one player; turnOrder is not allowed.",
        `${path}.turnOrder`,
      );
    }
    if (!isSupportedPlayerSelector(actor.player)) {
      unsupported(`actor { player: ${JSON.stringify(actor.player)} }`);
    }
    return { kind: "single", actor: assemblePlayerSelector(actor.player) };
  }
  if (!isSupportedActor(actor)) unsupported(`actor ${JSON.stringify(actor)}`);

  if (!turnOrder) return { kind: "round-robin" };
  if (!isSupportedTurnOrder(turnOrder) || turnOrder.kind !== "seat") {
    unsupported(
      turnOrder.kind !== "seat"
        ? `turnOrder kind '${turnOrder.kind}'`
        : `turnOrder direction '${turnOrder.direction}'`,
    );
  }
  const start = turnOrder.startingPlayer;
  if (start === undefined || start === "first") return { kind: "round-robin" };
  return { kind: "round-robin", start: assemblePlayerSelector(start) };
}

function assemblePlayerSelector(sel: SpecPlayerSelector): PlayerSelector {
  if (typeof sel === "object" && "stateRef" in sel && isSupportedPlayerSelector(sel)) {
    return { kind: "state-ref", path: sel.stateRef };
  }
  unsupported(`player selector ${JSON.stringify(sel)}`);
}

// ---------------------------------------------------------------------------
// Grammar mapping
// ---------------------------------------------------------------------------

function assembleGrammar(node: TurnGrammarNode): Grammar {
  if (node.kind === "action") {
    return { kind: "action", ref: node.ref };
  }

  if (node.kind === "slot" || !isSupportedGrammarKind(node.kind)) {
    throw new Error(
      `flow assembler: grammar kind 'slot' is not yet supported.`,
    );
  }

  if (node.kind === "sequence") {
    const actions = node.steps.map((step) => {
      if (!isActionNode(step)) {
        throw new Error(
          `flow assembler: sequence steps must all be 'action' nodes (got '${step.kind}').`,
        );
      }
      return step.ref;
    });
    return { kind: "sequence", actions };
  }

  if (node.kind === "choice") {
    if (!isSupportedPick(node.pick)) {
      throw new Error(`flow assembler: choice pick ${node.pick} is not yet supported.`);
    }
    const actions = node.options.map((opt) => {
      if (!isActionNode(opt)) {
        throw new Error(
          `flow assembler: choice options must all be 'action' nodes (got '${opt.kind}').`,
        );
      }
      return opt.ref;
    });
    return {
      kind: "choice",
      actions,
      ...(node.passable != null && { passable: node.passable }),
    };
  }

  // repeat
  if (!isSupportedRepeatBody(node.body)) {
    throw new Error(`flow assembler: a repeat nested inside a repeat is not yet supported.`);
  }
  const body = assembleGrammar(node.body);
  if (typeof node.count === "object" && "until" in node.count) {
    const endCondition = compilePredicate(node.count.until, ["game", "actor"]);
    return {
      kind: "repeat",
      body,
      count: {
        endCondition: (session: GameSession, actorId?: string) =>
          endCondition(sessionToEvalContext(session, actorId)),
        ...(node.count.max !== undefined && { max: node.count.max }),
      },
    };
  }
  return { kind: "repeat", body, count: node.count };
}

// ---------------------------------------------------------------------------
// FlowNode recursive assembly
// ---------------------------------------------------------------------------

type NodeIdFor = (node: GamedefFlowNode) => string;

/** 
 * Returns a function that generates unique ids for flow nodes based on their kind.
 * Explicit ids pass through; anonymous nodes get `${kind}-${n}`, skipping ids the 
 * spec already uses. */
function createNodeIdFor(rootId: string, children: GamedefFlowNode[]): NodeIdFor {
  const taken = new Set<string>([rootId]);
  const collect = (nodes: GamedefFlowNode[]) => {
    for (const n of nodes) {
      if (n.id) taken.add(n.id);
      if ("children" in n && Array.isArray(n.children)) collect(n.children);
    }
  };
  collect(children);

  const counters = new Map<string, number>();
  return (node) => {
    if (node.id) return node.id;
    let id: string;
    do {
      const n = (counters.get(node.kind) ?? 0) + 1;
      counters.set(node.kind, n);
      id = `${node.kind}-${n}`;
    } while (taken.has(id));
    taken.add(id);
    return id;
  };
}

function assembleFlowNode(
  node: GamedefFlowNode,
  effectDefs: Record<string, Record<string, unknown>>,
  idFor: NodeIdFor,
  path: string,
): FlowNode {
  const nodeId = idFor(node);

  if (!isSupportedInterruptWindows(node.interruptWindows)) {
    throw new Error(`flow assembler: node '${nodeId}' interruptWindows is not yet supported.`);
  }

  if (node.kind === "loop") {
    if (node.count != null && node.endCondition != null) {
      throw compileFailure(
        CompileCode.InvalidSpec,
        `flow assembler: loop '${nodeId}' has both 'count' and 'endCondition'; provide only one.`,
        path,
      );
    }
    if (!isSupportedLoopEnd(node.endCondition)) {
      throw new Error(
        `flow assembler: loop '${nodeId}' endCondition 'until-pass' is not yet supported.`,
      );
    }
    const checkAfter = node.checkAfter ?? "iteration";
    if (node.finalRound && checkAfter !== "turn") {
      throw compileFailure(
        CompileCode.InvalidSpec,
        `flow assembler: loop '${nodeId}' finalRound requires checkAfter: turn.`,
        `${path}.finalRound`,
      );
    }
    const endExpr =
      typeof node.endCondition === "string" ? node.endCondition : undefined;
    if (endExpr && checkAfter === "iteration" && /\bactor\./.test(endExpr)) {
      throw compileFailure(
        CompileCode.InvalidSpec,
        `flow assembler: loop '${nodeId}' endCondition references 'actor', which is only bound with checkAfter: turn.`,
        `${path}.endCondition`,
      );
    }
    const endPred = endExpr
      ? compilePredicate(endExpr, checkAfter === "turn" ? ["game", "actor"] : ["game"])
      : undefined;
    const result: LoopFlowNode = {
      kind: "loop",
      id: nodeId,
      label: node.label ?? nodeId,
      children: node.children.map((child, i) =>
        assembleFlowNode(child, effectDefs, idFor, `${path}.children[${i}]`),
      ),
      ...(node.count != null && { count: node.count }),
      ...(node.finalRound != null && { finalRound: node.finalRound }),
      ...(node.writeIterationTo != null && {
        writeIterationTo: node.writeIterationTo,
      }),
      ...(endPred && {
        endCondition: (session: GameSession, actorId?: string) =>
          endPred(sessionToEvalContext(session, actorId)),
      }),
      ...(node.checkAfter != null && { checkAfter: node.checkAfter }),
    };
    const hooks = assembleFlowHooks(node.hooks, nodeId, effectDefs);
    if (hooks) result.hooks = hooks;
    return result;
  }

  if (node.kind === "simultaneous" || !isSupportedFlowKind(node.kind)) {
    throw new Error(
      `flow assembler: FlowNode kind 'simultaneous' is not yet supported. Use 'loop' or 'turn'.`,
    );
  }

  if (!isSupportedTimeLimit(node.timeLimit)) {
    throw new Error(`flow assembler: turn '${nodeId}' timeLimit is not yet supported.`);
  }

  // turn
  const result: TurnFlowNode = {
    kind: "turn",
    id: nodeId,
    label: node.label ?? nodeId,
    ordering: assembleTurnOrdering(node.actor, node.turnOrder, path),
    grammar: assembleGrammar(node.grammar),
  };
  const hooks = assembleFlowHooks(node.hooks, nodeId, effectDefs);
  if (hooks) result.hooks = hooks;
  return result;
}

// ---------------------------------------------------------------------------
// Win conditions
// ---------------------------------------------------------------------------

/** Assemble win conditions. */
function assembleWinConditions(
  specConditions: WinCondition[],
  specId: string,
  effectDefs: Record<string, Record<string, unknown>>,
): WinConditionDef[] {
  return specConditions.map((wc, i) => {
    const prefix = `${specId}.winConditions_${i}`;

    const onVictory = wc.onVictory?.length
      ? normalizeEffectList(wc.onVictory, `${prefix}.onVictory`, effectDefs)
      : undefined;

    if (!isSupportedWinRule(wc.rule)) {
      throw new Error(
        `flow assembler: winCondition[${i}] rule 'role-condition' is not yet supported.`,
      );
    }

    switch (wc.rule) {
      case "ranking": {
        const propertyPath = wc.property;
        // TODO(Phase 6.5): replace with compileExpression(propertyPath) once expressions return numeric values.
        const match = propertyPath.match(/^player\.property\.(.+)$/);
        if (!match) {
          throw compileFailure(
            CompileCode.InvalidSpec,
            `flow assembler: winCondition[${i}] ranking property must be 'player.property.<key>' (got '${propertyPath}')`,
            `flow.root.winConditions[${i}].property`,
          );
        }
        const key = match[1];
        return {
          rule: "ranking" as const,
          value: (
            _session: import("@chaincraft/runtime").GameSession,
            playerId: string,
          ) => {
            return Number(
              _session.state.players[playerId]?.properties[key] ?? 0,
            );
          },
          order: wc.order ?? "highest",
          tiebreak: wc.tiebreak ?? "all-win",
          ...(onVictory && { onVictory }),
        };
      }
      case "condition": {
        if (/\bactor\./.test(wc.condition)) {
          throw compileFailure(
            CompileCode.InvalidSpec,
            `flow assembler: winCondition[${i}] references 'actor', but win conditions run after the game completes with no actor. Use 'player.*' for the player being evaluated.`,
            `flow.root.winConditions[${i}].condition`,
          );
        }
        const playerFilter = compilePlayerFilter(wc.condition, ["game", "player"]);
        return {
          rule: "condition" as const,
          condition: (
            session: import("@chaincraft/runtime").GameSession,
            playerId?: string,
          ) => {
            return playerFilter(session, playerId!);
          },
          ...(onVictory && { onVictory }),
        };
      }
      case "role-condition":
        throw new Error(
          `flow assembler: winCondition[${i}] rule 'role-condition' is not yet supported.`,
        );
    }
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assemble the spec's flow module into a runtime FlowNode tree.
 *
 * Inline hook effects are walked and stored in the effectDefs accumulator
 * under synthetic IDs; their call sites become { ref } entries.
 *
 * @param spec    - Parsed game spec (spec.flow must be present)
 * @param specId  - Used as the game-root's id
 * @param effectDefs - Mutable accumulator; inline hook effects are added here
 */
export function assembleFlow(
  spec: ModularGameSpec,
  specId: string,
  effectDefs: Record<string, Record<string, unknown>>,
): GameFlowNode {
  if (!spec.flow) {
    throw new Error(`flow assembler: spec '${specId}' has no flow module`);
  }

  const root = spec.flow.root as {
    kind: "game";
    label?: string;
    hooks?: { onEnter?: EffectCall[]; onComplete?: EffectCall[] };
    children: GamedefFlowNode[];
    winConditions?: WinCondition[];
  };

  const idFor = createNodeIdFor(specId, root.children);
  const gameNode: GameFlowNode = {
    kind: "game",
    id: specId,
    children: root.children.map((child, i) =>
      assembleFlowNode(child, effectDefs, idFor, `flow.root.children[${i}]`),
    ),
  };

  const hooks = assembleFlowHooks(root.hooks, specId, effectDefs);
  if (hooks) gameNode.hooks = hooks;

  if (root.winConditions?.length) {
    gameNode.winConditions = assembleWinConditions(
      root.winConditions,
      specId,
      effectDefs,
    );
  }

  return gameNode;
}
