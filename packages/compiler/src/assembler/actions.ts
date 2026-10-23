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
  ActionSegmentDef,
  ActionInputDef,
  ActionInputType,
  NumberInputType,
} from '@chaincraft/runtime';
import { normalizeEffectList } from '#compiler/assembler/effects.js';
import {
  compileInputValidation,
  compilePrecondition,
  compileSelectionFilter,
} from '#compiler/expressions/eval-bridge.js';
import { referencedInputs } from '#compiler/expressions/index.js';

/** Player-supplied inputs per action; with the action choice this fills the 5-response submit cap. */
export const MAX_PLAYER_INPUTS = 4;

/** Upper bound on answer combinations the runtime may enumerate when looking ahead. */
export const MAX_LOOKAHEAD_COMBINATIONS = 500;

const AUTO_INPUT_KINDS = new Set(['effect-originator', 'trigger-input']);
const SELECTION_KINDS = new Set(['gamepiece-select', 'player-select']);

/** Map a gamedef input step to the runtime's ActionInputDef; a selection's filter becomes its `validate`. */
function mapActionInput(step: ActionInput, dependsOn: string[]): ActionInputDef {
  const { filter, ...typeFields } = step.type as Record<string, unknown>;
  const type = typeFields as ActionInputType;

  let validate: ActionInputDef["validate"];
  if (SELECTION_KINDS.has(type.kind)) {
    if (typeof filter === 'string') {
      validate = compileSelectionFilter(
        type.kind as 'gamepiece-select' | 'player-select',
        step.input,
        filter,
      );
    }
  } else if (step.validation != null) {
    validate = compileInputValidation(step.validation);
  }

  return {
    id: step.input,
    ...(step.label != null && { label: step.label }),
    type,
    ...(validate && { validate }),
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

/**
 * Reject input shapes the runtime cannot prompt for or look ahead through.
 * Limits on the whole action apply across segments; lookahead rules apply per segment.
 */
function checkActionInputs(
  actionId: string,
  segmentInputs: readonly (readonly ActionInputDef[])[],
): void {
  const inputs = segmentInputs.flat();
  for (const input of inputs) {
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

  for (const segment of segmentInputs) {
    const ids = new Set(segment.map((i) => i.id));
    const dependedOn = new Set(segment.flatMap((i) => i.dependsOn ?? []));
    let combinations = 1;
    for (const input of segment) {
      const count = staticOptionCount(input.type);
      if (dependedOn.has(input.id) && count === undefined) {
        fail(
          actionId,
          `input "${input.id}" is read by a later input but has no finite option list ` +
            "(use enum, boolean, a selection, or a whole-number range with min and max)",
        );
      }
      const inChain =
        dependedOn.has(input.id) || (input.dependsOn ?? []).some((d) => ids.has(d));
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
}

/**
 * Split an action's steps into segments (inputs then effects). An input that follows an
 * effect starts a new segment. Throws when the last segment ends with inputs.
 */
function buildSegments(
  actionId: string,
  steps: readonly ActionStep[],
): { inputs: ActionInput[]; effects: EffectCall[] }[] {
  const segments: { inputs: ActionInput[]; effects: EffectCall[] }[] = [
    { inputs: [], effects: [] },
  ];
  for (const step of steps) {
    let current = segments[segments.length - 1];
    if ("input" in step) {
      if (current.effects.length > 0) {
        current = { inputs: [], effects: [] };
        segments.push(current);
      }
      current.inputs.push(step);
    } else {
      current.effects.push(step);
    }
  }
  const last = segments[segments.length - 1];
  if (last.effects.length === 0 && last.inputs.length > 0) {
    fail(
      actionId,
      `input "${last.inputs[last.inputs.length - 1].input}" has no effect step after it; ` +
        "nothing can use its answer",
    );
  }
  return segments;
}

/**
 * Compile all actions from the spec into ActionDef objects.
 *
 * Steps are grouped into segments of inputs followed by effects. Inline effect steps are
 * walked and assigned synthetic IDs (indexed among all effect steps of the action), then
 * added to the provided effectDefs accumulator. Each segment's effects become { ref } entries.
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
    const rawSegments = buildSegments(action.id, action.steps);
    const allEffects = normalizeEffectList(
      rawSegments.flatMap((s) => s.effects),
      `${action.id}._effect`,
      effectDefs,
    );

    const earlier = new Set<string>();
    let effectOffset = 0;
    const segments: ActionSegmentDef[] = rawSegments.map((raw) => {
      const inputs: ActionInputDef[] = raw.inputs.map((step) => {
        const kind = (step.type as { kind: string }).kind;
        if (step.validation != null && SELECTION_KINDS.has(kind)) {
          fail(
            action.id,
            `input "${step.input}" is a ${kind}; use 'filter' instead of 'validation' ` +
              "(compare identities with piece.id / player.id)",
          );
        }
        const def = mapActionInput(step, inputDependencies(action.id, step, earlier));
        earlier.add(step.input);
        return def;
      });
      const effects = allEffects.slice(effectOffset, effectOffset + raw.effects.length);
      effectOffset += raw.effects.length;
      return { inputs, effects };
    });
    checkActionInputs(
      action.id,
      segments.map((s) => s.inputs),
    );

    const precondition =
      typeof action.preconditions === 'string'
        ? compilePrecondition(action.preconditions)
        : undefined;

    actions[action.id] = {
      id: action.id,
      label: action.label ?? action.id,
      description: action.description ?? "",
      segments,
      ...(precondition != null && { precondition }),
    };
  }

  return actions;
}
