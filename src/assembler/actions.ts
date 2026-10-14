// ---------------------------------------------------------------------------
// Actions assembler
//
// Produces: Record<string, ActionDef> — one entry per action in the spec,
// keyed by action ID. Inline effects within actions are walked via
// walkEffectBody and stored in a shared effectDefs accumulator with
// synthetic IDs.
// ---------------------------------------------------------------------------

import type { ModularGameSpec, ActionInput, ActionStep, EffectCall } from '@chaincraft/gamedef';
import { numberOptionCount } from '@chaincraft/runtime';
import type {
  ActionDef,
  ActionInputDef,
  ActionInputType,
  NumberInputType,
} from '@chaincraft/runtime';
import { normalizeEffectList } from '#compiler/assembler/effects.js';
import {
  compileInputValidation,
  compilePieceFilter,
  compilePlayerFilter,
  compilePrecondition,
} from '#compiler/expressions/eval-bridge.js';
import { referencedInputs } from '#compiler/expressions/index.js';

/** Player-supplied inputs per action; with the action choice this fills the 5-response submit cap. */
export const MAX_PLAYER_INPUTS = 4;

/** Upper bound on answer combinations the runtime may enumerate when looking ahead. */
export const MAX_LOOKAHEAD_COMBINATIONS = 500;

const AUTO_INPUT_KINDS = new Set(['effect-originator', 'trigger-input']);
const SELECTION_KINDS = new Set(['gamepiece-select', 'player-select']);

/** Map a gamedef input step to the runtime's ActionInputDef, compiling filter expressions. */
function mapActionInput(step: ActionInput, dependsOn: string[]): ActionInputDef {
  const rawType = step.type as Record<string, unknown>;
  let type: ActionInputType;

  if (rawType.kind === 'gamepiece-select' && typeof rawType.filter === 'string') {
    type = {
      ...(rawType as ActionInputType),
      filter: compilePieceFilter(rawType.filter),
    } as ActionInputType;
  } else if (rawType.kind === 'player-select' && typeof rawType.filter === 'string') {
    type = {
      ...(rawType as ActionInputType),
      filter: compilePlayerFilter(rawType.filter),
    } as ActionInputType;
  } else {
    type = rawType as ActionInputType;
  }

  return {
    id: step.input,
    ...(step.label != null && { label: step.label }),
    type,
    ...(step.validation != null && { validate: compileInputValidation(step.validation) }),
    ...(step.validationMessage != null && { validationMessage: step.validationMessage }),
    ...(dependsOn.length > 0 && { dependsOn }),
  };
}

function fail(actionId: string, message: string): never {
  throw new Error(`actions assembler: action "${actionId}" ${message}`);
}

/** Earlier input ids this input's options depend on. Throws on any other reference. */
function inputDependencies(
  actionId: string,
  step: ActionInput,
  earlier: ReadonlySet<string>,
): string[] {
  const refs = new Set<string>();
  const rawType = step.type as { fromPlayer?: unknown; filter?: unknown };
  const fromPlayer = rawType.fromPlayer;
  if (typeof fromPlayer === "object" && fromPlayer !== null && "param" in fromPlayer) {
    refs.add(String(fromPlayer.param));
  }
  if (typeof rawType.filter === "string") {
    for (const ref of referencedInputs(rawType.filter)) refs.add(ref);
  }
  if (step.validation != null) {
    // Validation sees its own candidate answer as input.<id>.
    for (const ref of referencedInputs(step.validation)) {
      if (ref !== step.input) refs.add(ref);
    }
  }
  for (const ref of refs) {
    if (!earlier.has(ref)) {
      fail(
        actionId,
        `input "${step.input}" references "${ref}", which is not an earlier input of the same action`,
      );
    }
  }
  return [...refs];
}

/**
 * Options an input lists at compile time: a count for enum/boolean/bounded numbers,
 * "dynamic" for selections (finite, state-dependent), undefined when there is no list.
 */
function staticOptionCount(type: ActionInputType): number | "dynamic" | undefined {
  switch (type.kind) {
    case "enum":
      return type.values.length;
    case "boolean":
      return 2;
    case "number":
      return numberOptionCount(type);
    case "player-select":
    case "gamepiece-select":
      return "dynamic";
    default:
      return undefined;
  }
}

/** Reject input shapes the runtime cannot prompt for or look ahead through. */
function checkActionInputs(actionId: string, inputs: readonly ActionInputDef[]): void {
  for (const input of inputs) {
    if (input.validate && SELECTION_KINDS.has(input.type.kind)) {
      fail(
        actionId,
        `input "${input.id}" is a ${input.type.kind}; use 'filter' instead of 'validation' ` +
          "(compare identities with piece.id / player.id)",
      );
    }
    if (input.type.kind === "number") {
      const { min, max } = input.type as NumberInputType;
      if (min !== undefined && max !== undefined && min > max) {
        fail(actionId, `input "${input.id}" has min ${min} greater than max ${max}`);
      }
    }
  }

  const playerInputs = inputs.filter((i) => !AUTO_INPUT_KINDS.has(i.type.kind));
  if (playerInputs.length > MAX_PLAYER_INPUTS) {
    fail(
      actionId,
      `has ${playerInputs.length} player-supplied inputs; at most ${MAX_PLAYER_INPUTS} are allowed`,
    );
  }

  const dependedOn = new Set(inputs.flatMap((i) => i.dependsOn ?? []));
  let combinations = 1;
  for (const input of inputs) {
    const count = staticOptionCount(input.type);
    if (dependedOn.has(input.id) && count === undefined) {
      fail(
        actionId,
        `input "${input.id}" is read by a later input but has no finite option list ` +
          "(use enum, boolean, a selection, or a whole-number range with min and max)",
      );
    }
    const inChain = dependedOn.has(input.id) || (input.dependsOn?.length ?? 0) > 0;
    if (inChain && typeof count === "number") combinations *= count;
  }
  if (combinations > MAX_LOOKAHEAD_COMBINATIONS) {
    fail(
      actionId,
      `dependent inputs allow ${combinations} answer combinations; at most ` +
        `${MAX_LOOKAHEAD_COMBINATIONS} are allowed`,
    );
  }
}

/**
 * Split an action's steps into the runtime's inputs-then-effects shape.
 * Throws on an input after an effect: the runtime collects every input before any effect runs.
 */
function splitSteps(
  actionId: string,
  steps: readonly ActionStep[],
): { inputs: ActionInput[]; effects: EffectCall[] } {
  const inputs: ActionInput[] = [];
  const effects: EffectCall[] = [];
  for (const step of steps) {
    if ("input" in step) {
      if (effects.length > 0) {
        fail(
          actionId,
          `input "${step.input}" comes after an effect step; all input steps must come ` +
            "before the first effect step",
        );
      }
      inputs.push(step);
    } else {
      effects.push(step);
    }
  }
  return { inputs, effects };
}

/**
 * Compile all actions from the spec into ActionDef objects.
 *
 * Input steps become the ActionDef's inputs. Inline effect steps are walked and
 * assigned synthetic IDs (indexed among effect steps only), then added to the
 * provided effectDefs accumulator. The action's effects[] array becomes all { ref } entries.
 *
 * @param spec - The parsed game spec
 * @param effectDefs - Mutable accumulator; inline effects are added here
 * @returns Record of ActionDef keyed by action ID
 */
export function assembleActions(
  spec: ModularGameSpec,
  effectDefs: Record<string, Record<string, unknown>>,
): Record<string, ActionDef> {
  const actions: Record<string, ActionDef> = {};

  if (!spec.actions?.actions) return actions;

  for (const action of spec.actions.actions) {
    const steps = splitSteps(action.id, action.steps);
    const effects = normalizeEffectList(steps.effects, `${action.id}._effect`, effectDefs);

    const earlier = new Set<string>();
    const inputs: ActionInputDef[] = steps.inputs.map((step) => {
      const def = mapActionInput(step, inputDependencies(action.id, step, earlier));
      earlier.add(step.input);
      return def;
    });
    checkActionInputs(action.id, inputs);

    const precondition =
      typeof action.preconditions === 'string'
        ? compilePrecondition(action.preconditions)
        : undefined;

    actions[action.id] = {
      id: action.id,
      label: action.label ?? action.id,
      description: action.description ?? "",
      inputs,
      effects,
      ...(precondition != null && { precondition }),
    };
  }

  return actions;
}
