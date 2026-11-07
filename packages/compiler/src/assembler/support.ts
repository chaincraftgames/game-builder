// ---------------------------------------------------------------------------
// Support checks — schema-valid forms the compiler does not implement yet.
//
// Each predicate is shared by findUnsupported() (reported at validate time) and
// the assemblers (guards that still throw if a spec reaches them), so the two
// cannot drift. To support a form later: implement it in its assembler, then
// delete its check here.
// ---------------------------------------------------------------------------

import type {
  ModularGameSpec,
  ActorSpec,
  TurnOrder,
  TurnGrammarNode,
  PlayerSelector,
} from "@chaincraft/gamedef";
import { CompileCode } from "#compiler/assembler/types.js";
import type { CompileIssue } from "#compiler/assembler/errors.js";

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/** `first` is allowed only as a turn order's `startingPlayer`. */
export function isSupportedPlayerSelector(sel: PlayerSelector, allowFirst = false): boolean {
  if (sel === "first") return allowFirst;
  return typeof sel === "object" && "stateRef" in sel && sel.offset === undefined;
}

export function isSupportedActor(actor: ActorSpec): boolean {
  if (actor === "all") return true;
  return "player" in actor && isSupportedPlayerSelector(actor.player);
}

/** Checks kind and direction only; `startingPlayer` is checked as a selector. */
export function isSupportedTurnOrder(turnOrder: TurnOrder): boolean {
  return turnOrder.kind === "seat" && turnOrder.direction === "clockwise";
}

export function isSupportedFlowKind(kind: string): boolean {
  return kind !== "simultaneous";
}

export function isSupportedLoopEnd(endCondition: unknown): boolean {
  return endCondition !== "until-pass";
}

export function isActionNode(node: TurnGrammarNode): node is { kind: "action"; ref: string } {
  return node.kind === "action";
}

export function isSupportedGrammarKind(kind: string): boolean {
  return kind !== "slot";
}

/** The runtime cursor has one `repeatCount`, so a repeat cannot contain another repeat. */
export function isSupportedRepeatBody(body: TurnGrammarNode): boolean {
  return body.kind !== "repeat";
}

/** Only one pick per choice (the default) is implemented. */
export function isSupportedPick(pick: number | undefined): boolean {
  return pick === undefined || pick === 1;
}

export function isSupportedWinRule(rule: string): boolean {
  return rule !== "role-condition";
}

export function isSupportedGameMechanic(kind: string): boolean {
  return kind === "chaincraft:dominant-gamepiece";
}

/** `dominant` and `matrix` rules and `comparison` with an explicit `order` are not implemented. */
export function isSupportedDominantRule(rule: { kind: string; order?: unknown }): boolean {
  return rule.kind === "comparison" && rule.order === undefined;
}

/** Turn time limits are accepted by the schema but never enforced. */
export function isSupportedTimeLimit(timeLimit: number | undefined): boolean {
  return timeLimit === undefined;
}

export function isSupportedInterruptWindows(windows: readonly unknown[] | undefined): boolean {
  return windows === undefined || windows.length === 0;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

const ACTOR_HINT =
  "Supported: `actor: all` (optionally with `turnOrder: { kind: seat, direction: clockwise }`), " +
  "or `actor: { player: { stateRef: <path> } }` without `offset`.";
const START_HINT = "Supported: `first` or `{ stateRef: <path> }` without `offset`.";
const TURN_ORDER_HINT = "Supported: `{ kind: seat, direction: clockwise }`.";
const GRAMMAR_HINT =
  "Each option or step must be `{ kind: action, ref }`. Gate actions with `preconditions` instead of nesting.";

function unsupportedIssue(path: string, what: string, hint?: string): CompileIssue {
  return {
    code: CompileCode.Unsupported,
    path,
    message: `${what} is not supported by the compiler yet.${hint ? ` ${hint}` : ""}`,
  };
}

// ---------------------------------------------------------------------------
// Walk
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

function checkGrammar(node: TurnGrammarNode, path: string, out: CompileIssue[]): void {
  if (!isSupportedGrammarKind(node.kind)) {
    out.push(
      unsupportedIssue(path, `grammar kind "${node.kind}"`, "Use `choice` over `{ kind: action, ref }` options."),
    );
    return;
  }

  if (node.kind === "sequence" || node.kind === "choice") {
    const children = node.kind === "sequence" ? node.steps : node.options;
    const key = node.kind === "sequence" ? "steps" : "options";
    const noun = node.kind === "sequence" ? "step" : "option";
    children.forEach((child, i) => {
      const childPath = `${path}.${key}[${i}]`;
      if (!isActionNode(child) && isSupportedGrammarKind(child.kind)) {
        out.push(unsupportedIssue(childPath, `${node.kind} ${noun} of kind "${child.kind}"`, GRAMMAR_HINT));
      }
      checkGrammar(child, childPath, out);
    });
    if (node.kind === "choice" && !isSupportedPick(node.pick)) {
      out.push(unsupportedIssue(`${path}.pick`, `choice pick: ${node.pick}`, "Omit `pick`; one option is chosen."));
    }
  }

  if (node.kind === "repeat") {
    if (!isSupportedRepeatBody(node.body)) {
      out.push(
        unsupportedIssue(
          `${path}.body`,
          "a repeat nested inside a repeat",
          "Use one repeat over `{ kind: action, ref }` or a `choice` of actions; fold repeated steps into the action itself.",
        ),
      );
      return;
    }
    checkGrammar(node.body, `${path}.body`, out);
  }
}

function checkActor(actor: ActorSpec, path: string, out: CompileIssue[]): void {
  if (isSupportedActor(actor)) return;
  if (typeof actor === "object" && "player" in actor) {
    out.push(
      unsupportedIssue(`${path}.player`, `player selector ${JSON.stringify(actor.player)}`, ACTOR_HINT),
    );
    return;
  }
  out.push(unsupportedIssue(path, `actor ${JSON.stringify(actor)}`, ACTOR_HINT));
}

function checkTurnOrder(turnOrder: TurnOrder, path: string, out: CompileIssue[]): void {
  if (turnOrder.kind !== "seat" || !isSupportedTurnOrder(turnOrder)) {
    const what =
      turnOrder.kind !== "seat"
        ? `turnOrder kind "${turnOrder.kind}"`
        : `turnOrder direction "${turnOrder.direction}"`;
    out.push(unsupportedIssue(path, what, TURN_ORDER_HINT));
    return;
  }
  const start = turnOrder.startingPlayer;
  if (start !== undefined && !isSupportedPlayerSelector(start, true)) {
    out.push(
      unsupportedIssue(`${path}.startingPlayer`, `player selector ${JSON.stringify(start)}`, START_HINT),
    );
  }
}

function checkFlowNode(node: Obj, path: string, out: CompileIssue[]): void {
  const kind = node.kind as string;
  if (!isSupportedFlowKind(kind)) {
    out.push(unsupportedIssue(path, `flow node kind "${kind}"`, "Use `loop` or `turn`."));
    return;
  }

  if (!isSupportedInterruptWindows(node.interruptWindows as unknown[] | undefined)) {
    out.push(unsupportedIssue(`${path}.interruptWindows`, "interruptWindows", "Remove them."));
  }

  if (kind === "loop") {
    if (!isSupportedLoopEnd(node.endCondition)) {
      out.push(
        unsupportedIssue(
          `${path}.endCondition`,
          `loop endCondition "until-pass"`,
          "Use an endCondition expression or a `count`.",
        ),
      );
    }
    (node.children as Obj[]).forEach((child, i) => checkFlowNode(child, `${path}.children[${i}]`, out));
    return;
  }

  checkActor(node.actor as ActorSpec, `${path}.actor`, out);
  if (node.turnOrder !== undefined) checkTurnOrder(node.turnOrder as TurnOrder, `${path}.turnOrder`, out);
  if (!isSupportedTimeLimit(node.timeLimit as number | undefined)) {
    out.push(unsupportedIssue(`${path}.timeLimit`, "timeLimit", "Remove it; turns are not timed."));
  }
  checkGrammar(node.grammar as TurnGrammarNode, `${path}.grammar`, out);
}

function checkFlow(spec: ModularGameSpec, out: CompileIssue[]): void {
  if (!spec.flow) return;
  const root = spec.flow.root as unknown as Obj;
  const rootPath = "flow.root";

  (root.children as Obj[] | undefined)?.forEach((child, i) =>
    checkFlowNode(child, `${rootPath}.children[${i}]`, out),
  );

  (root.winConditions as { rule: string }[] | undefined)?.forEach((wc, i) => {
    if (!isSupportedWinRule(wc.rule)) {
      out.push(
        unsupportedIssue(
          `${rootPath}.winConditions[${i}]`,
          `win condition rule "${wc.rule}"`,
          "Use `rule: condition` or `rule: ranking`.",
        ),
      );
    }
  });
}

function checkMechanics(spec: ModularGameSpec, out: CompileIssue[]): void {
  spec.mechanics?.forEach((mechanic, i) => {
    const path = `mechanics[${i}]`;
    if (!isSupportedGameMechanic(mechanic.kind)) {
      out.push(unsupportedIssue(path, `mechanic kind "${mechanic.kind}"`, "Supported: `chaincraft:dominant-gamepiece`."));
      return;
    }
    const rules = (mechanic as unknown as { rules?: { kind: string; order?: unknown }[] }).rules ?? [];
    rules.forEach((rule, ri) => {
      if (isSupportedDominantRule(rule)) return;
      const rulePath = `${path}.rules[${ri}]`;
      if (rule.kind === "comparison") {
        out.push(unsupportedIssue(`${rulePath}.order`, "comparison rule `order`", "Omit `order` to compare a numeric property."));
      } else {
        out.push(unsupportedIssue(rulePath, `dominant-gamepiece rule kind "${rule.kind}"`, "Supported: `comparison` without `order`."));
      }
    });
  });
}

/** Spec fields the schema accepts that no assembler reads. */
const IGNORED_ACTION_FIELDS = ["requiredRoles", "interrupt", "availableInSubflows", "reactive"] as const;
const IGNORED_PIECE_FIELDS = ["actionSlots", "mechanics", "reactiveSlots"] as const;

function checkIgnoredFields(spec: ModularGameSpec, out: CompileIssue[]): void {
  spec.actions?.actions?.forEach((action, i) => {
    for (const field of IGNORED_ACTION_FIELDS) {
      if ((action as Obj)[field] !== undefined) {
        out.push(unsupportedIssue(`actions.actions[${i}].${field}`, `action \`${field}\``, "Remove it."));
      }
    }
  });
  spec.gamepieceTypes?.types?.forEach((type, i) => {
    for (const field of IGNORED_PIECE_FIELDS) {
      const value = (type as Obj)[field] as unknown[] | undefined;
      if (value !== undefined && value.length > 0) {
        out.push(unsupportedIssue(`gamepieceTypes.types[${i}].${field}`, `gamepiece type \`${field}\``, "Remove it."));
      }
    }
  });
}

/**
 * One issue per occurrence of a schema-valid form the compiler cannot assemble yet.
 *
 * @param spec - A spec that passed gamedef validation.
 */
export function findUnsupported(spec: ModularGameSpec): CompileIssue[] {
  const issues: CompileIssue[] = [];
  checkFlow(spec, issues);
  checkMechanics(spec, issues);
  checkIgnoredFields(spec, issues);
  return issues;
}
