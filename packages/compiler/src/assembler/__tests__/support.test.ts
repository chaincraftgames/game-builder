// ---------------------------------------------------------------------------
// findUnsupported — one fixture per schema-valid form the compiler can't assemble yet.
//
// Each fixture patches High Card after gamedef validation (like assembler.test.ts)
// and asserts: exactly one issue with the expected path, and that the assemblers
// still refuse the spec on their own.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { load } from 'js-yaml';
import { validate } from '@chaincraft/gamedef/validator';
import type { ModularGameSpec } from '@chaincraft/gamedef';
import {
  assembleConfig, assembleFlow, assembleModule, applyMechanics,
  CompileCode, CompileError, findUnsupported,
} from '../index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(__dirname, '../../../../gamedef/examples/');

function loadExample(filename: string): ModularGameSpec {
  const result = validate(load(readFileSync(join(EXAMPLES, filename), 'utf-8')));
  if (!result.valid) throw new Error(`${filename} failed validation: ${JSON.stringify(result.errors, null, 2)}`);
  return result.spec;
}

type Obj = Record<string, any>;

/** High Card's tricks loop, its turn node, and the dominant-gamepiece mechanic. */
function parts(spec: ModularGameSpec) {
  const root = spec.flow!.root as unknown as Obj;
  const loop = root.children[0] as Obj;
  const turn = loop.children[0] as Obj;
  const mechanic = spec.mechanics![0] as unknown as Obj;
  const action = spec.actions!.actions[0] as unknown as Obj;
  const pieceType = spec.gamepieceTypes!.types[0] as unknown as Obj;
  return { spec, root, loop, turn, mechanic, action, pieceType };
}

const T = 'flow.root.children[0].children[0]';
const L = 'flow.root.children[0]';
const seat = { kind: 'seat', direction: 'clockwise' };
const stateRef = { stateRef: 'game.property.roundWinner' };

interface Fixture {
  name: string;
  path: string;
  /** Which assembler guard fires when the spec bypasses assembleModule. */
  guard?: 'flow' | 'mechanics';
  patch: (p: ReturnType<typeof parts>) => void;
}

const FIXTURES: Fixture[] = [
  { name: 'actor { player: first }', path: `${T}.actor.player`, guard: 'flow', patch: ({ turn }) => { delete turn.turnOrder; turn.actor = { player: 'first' }; } },
  { name: 'actor { player: { stateRef, offset } }', path: `${T}.actor.player`, guard: 'flow', patch: ({ turn }) => { delete turn.turnOrder; turn.actor = { player: { ...stateRef, offset: 1 } }; } },
  { name: 'actor { player: { role } }', path: `${T}.actor.player`, guard: 'flow', patch: ({ turn }) => { delete turn.turnOrder; turn.actor = { player: { role: 'dealer' } }; } },
  { name: 'actor { roles }', path: `${T}.actor`, guard: 'flow', patch: ({ turn }) => { turn.actor = { roles: ['dealer'] }; } },
  { name: 'actor { where }', path: `${T}.actor`, guard: 'flow', patch: ({ turn }) => { turn.actor = { where: 'not player.property.eliminated' }; } },
  { name: 'ranked turnOrder', path: `${T}.turnOrder`, guard: 'flow', patch: ({ turn }) => { turn.turnOrder = { kind: 'ranked', by: { playerProperty: 'score' }, order: 'ascending' }; } },
  { name: 'explicit turnOrder', path: `${T}.turnOrder`, guard: 'flow', patch: ({ turn }) => { turn.turnOrder = { kind: 'explicit', players: ['alice', 'bob'] }; } },
  { name: 'counter-clockwise turnOrder', path: `${T}.turnOrder`, guard: 'flow', patch: ({ turn }) => { turn.turnOrder = { kind: 'seat', direction: 'counter-clockwise' }; } },
  { name: 'startingPlayer random', path: `${T}.turnOrder.startingPlayer`, guard: 'flow', patch: ({ turn }) => { turn.turnOrder = { ...seat, startingPlayer: 'random' }; } },
  { name: 'startingPlayer { stateRef, offset }', path: `${T}.turnOrder.startingPlayer`, guard: 'flow', patch: ({ turn }) => { turn.turnOrder = { ...seat, startingPlayer: { ...stateRef, offset: 1 } }; } },
  { name: 'startingPlayer { highest }', path: `${T}.turnOrder.startingPlayer`, guard: 'flow', patch: ({ turn }) => { turn.turnOrder = { ...seat, startingPlayer: { highest: { playerProperty: 'score' } } }; } },
  { name: 'grammar slot', path: `${T}.grammar`, guard: 'flow', patch: ({ turn }) => { turn.grammar = { kind: 'slot', inventory: 'hand', slot: 'play', select: 'any' }; } },
  { name: 'sequence step that is not an action', path: `${T}.grammar.steps[1]`, guard: 'flow', patch: ({ turn }) => { turn.grammar = { kind: 'sequence', steps: [{ kind: 'action', ref: 'playCard' }, { kind: 'repeat', count: 2, body: { kind: 'action', ref: 'playCard' } }] }; } },
  { name: 'choice option that is not an action', path: `${T}.grammar.options[1]`, guard: 'flow', patch: ({ turn }) => { turn.grammar = { kind: 'choice', options: [{ kind: 'action', ref: 'playCard' }, { kind: 'repeat', count: 2, body: { kind: 'action', ref: 'playCard' } }] }; } },
  { name: 'repeat nested in a repeat body', path: `${T}.grammar.body`, guard: 'flow', patch: ({ turn }) => { turn.grammar = { kind: 'repeat', count: 2, body: { kind: 'repeat', count: { until: 'game.property.done == true' }, body: { kind: 'choice', options: [{ kind: 'action', ref: 'playCard' }] } } }; } },
  { name: 'fixed-count repeat nested in a repeat body', path: `${T}.grammar.body`, guard: 'flow', patch: ({ turn }) => { turn.grammar = { kind: 'repeat', count: { max: 3 }, body: { kind: 'repeat', count: 2, body: { kind: 'action', ref: 'playCard' } } }; } },
  { name: 'choice pick above 1', path: `${T}.grammar.pick`, guard: 'flow', patch: ({ turn }) => { turn.grammar = { kind: 'choice', pick: 2, options: [{ kind: 'action', ref: 'playCard' }, { kind: 'action', ref: 'playCard' }] }; } },
  { name: 'loop endCondition until-pass', path: `${L}.endCondition`, guard: 'flow', patch: ({ loop }) => { delete loop.count; loop.endCondition = 'until-pass'; } },
  { name: 'simultaneous node', path: `${L}.children[1]`, guard: 'flow', patch: ({ loop, turn }) => { loop.children.push({ ...turn, kind: 'simultaneous', id: 'sim', turnOrder: undefined }); } },
  { name: 'turn timeLimit', path: `${T}.timeLimit`, guard: 'flow', patch: ({ turn }) => { turn.timeLimit = 30000; } },
  { name: 'turn interruptWindows', path: `${T}.interruptWindows`, guard: 'flow', patch: ({ turn }) => { turn.interruptWindows = [{ id: 'w', trigger: 'awardTrick', timing: 'after', eligiblePlayers: 'all', actions: ['playCard'] }]; } },
  { name: 'role-condition win rule', path: 'flow.root.winConditions[1]', guard: 'flow', patch: ({ root }) => { root.winConditions.push({ rule: 'role-condition', condition: 'true', winners: { roles: ['dealer'] } }); } },
  { name: 'score-track mechanic', path: 'mechanics[1]', guard: 'mechanics', patch: ({ spec }) => { spec.mechanics!.push({ kind: 'chaincraft:score-track' } as never); } },
  { name: 'dominant rule', path: 'mechanics[0].rules[0]', guard: 'mechanics', patch: ({ mechanic }) => { mechanic.rules = [{ kind: 'dominant', property: 'value', dominantValue: 1 }]; } },
  { name: 'matrix rule', path: 'mechanics[0].rules[0]', guard: 'mechanics', patch: ({ mechanic }) => { mechanic.rules = [{ kind: 'matrix', property: 'value', beats: { a: ['b'] } }]; } },
  { name: 'comparison rule order', path: 'mechanics[0].rules[0].order', guard: 'mechanics', patch: ({ mechanic }) => { mechanic.rules = [{ kind: 'comparison', property: 'value', order: [1, 2, 3] }]; } },
  { name: 'action requiredRoles', path: 'actions.actions[0].requiredRoles', patch: ({ action }) => { action.requiredRoles = ['dealer']; } },
  { name: 'action interrupt', path: 'actions.actions[0].interrupt', patch: ({ action }) => { action.interrupt = ['tricks']; } },
  { name: 'action availableInSubflows', path: 'actions.actions[0].availableInSubflows', patch: ({ action }) => { action.availableInSubflows = ['tricks']; } },
  { name: 'action reactive', path: 'actions.actions[0].reactive', patch: ({ action }) => { action.reactive = { trigger: 'awardTrick', timing: 'after' }; } },
  { name: 'piece actionSlots', path: 'gamepieceTypes.types[0].actionSlots', patch: ({ pieceType }) => { pieceType.actionSlots = [{ id: 'play' }]; } },
  { name: 'piece mechanics', path: 'gamepieceTypes.types[0].mechanics', patch: ({ pieceType }) => { pieceType.mechanics = [{ kind: 'chaincraft:charges' }]; } },
  { name: 'piece reactiveSlots', path: 'gamepieceTypes.types[0].reactiveSlots', patch: ({ pieceType }) => { pieceType.reactiveSlots = [{ id: 'r' }]; } },
];

/** Loads High Card with the fixture's patch applied. */
function build(fixture: Fixture): ModularGameSpec {
  const spec = loadExample('high-card.yaml');
  fixture.patch(parts(spec));
  return spec;
}

describe('findUnsupported', () => {
  it('reports nothing for a supported spec', () => {
    expect(findUnsupported(loadExample('high-card.yaml'))).toEqual([]);
    expect(findUnsupported(loadExample('liars-dice.yaml'))).toEqual([]);
  });

  describe.each(FIXTURES)('$name', (fixture) => {
    it('is reported once, with its path', () => {
      const issues = findUnsupported(build(fixture));
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ code: CompileCode.Unsupported, path: fixture.path });
      expect(issues[0].message).toMatch(/ is not supported by the compiler yet\./);
    });

    it('is refused by assembleModule with an unsupported CompileError', () => {
      const spec = build(fixture);
      let caught: unknown;
      try {
        assembleModule(spec, 'high-card');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(CompileError);
      expect((caught as CompileError).issues).toEqual(findUnsupported(spec));
    });

    if (fixture.guard === 'flow') {
      it('is still refused by assembleFlow on its own', () => {
        expect(() => assembleFlow(build(fixture), 'high-card', {})).toThrow(
          /is not yet supported|must all be 'action' nodes/,
        );
      });
    }
    if (fixture.guard === 'mechanics' && fixture.name !== 'score-track mechanic') {
      it('is still refused by applyMechanics on its own', () => {
        const spec = build(fixture);
        const builder = { specId: 'high-card', config: assembleConfig(spec), effectDefs: {}, effects: {}, actions: {} };
        expect(() => applyMechanics(spec.mechanics, builder)).toThrow('is not yet supported');
      });
    }
  });

  it('refuses an unknown mechanic kind on its own', () => {
    const spec = loadExample('high-card.yaml');
    const builder = { specId: 'high-card', config: assembleConfig(spec), effectDefs: {}, effects: {}, actions: {} };
    expect(() => applyMechanics([{ kind: 'chaincraft:score-track' }] as never, builder)).toThrow('unknown mechanic kind');
  });

  it('accepts choice pick: 1, an empty interruptWindows and an action-only choice', () => {
    const spec = loadExample('high-card.yaml');
    const { turn } = parts(spec);
    turn.interruptWindows = [];
    turn.grammar = { kind: 'choice', pick: 1, options: [{ kind: 'action', ref: 'playCard' }] };
    expect(findUnsupported(spec)).toEqual([]);
  });

  it('reports every occurrence', () => {
    const spec = loadExample('high-card.yaml');
    const { turn } = parts(spec);
    turn.actor = { roles: ['dealer'] };
    turn.timeLimit = 5;
    expect(findUnsupported(spec).map((i) => i.path)).toEqual([`${T}.actor`, `${T}.timeLimit`]);
  });

  it('does not report a repeat with until-pass or a nested repeat body', () => {
    const spec = loadExample('high-card.yaml');
    const { turn } = parts(spec);
    turn.grammar = { kind: 'repeat', count: 'until-pass', body: { kind: 'choice', passable: true, options: [{ kind: 'action', ref: 'playCard' }] } };
    expect(findUnsupported(spec)).toEqual([]);
  });

  it('does not report a top-level repeat with count: { until, max }', () => {
    const spec = loadExample('high-card.yaml');
    const { turn } = parts(spec);
    turn.grammar = { kind: 'repeat', count: { until: 'game.property.done == true', max: 3 }, body: { kind: 'choice', options: [{ kind: 'action', ref: 'playCard' }] } };
    expect(findUnsupported(spec)).toEqual([]);
  });
});

describe('examples', () => {
  it.each(readdirSync(EXAMPLES).filter((f) => f.endsWith('.yaml')))('%s: findUnsupported agrees with assembleModule', (file) => {
    const result = validate(load(readFileSync(join(EXAMPLES, file), 'utf-8')));
    if (!result.valid) return;
    const issues = findUnsupported(result.spec);
    if (issues.length > 0) {
      expect(() => assembleModule(result.spec, file)).toThrow(CompileError);
    }
  });
});

describe('spec errors and limits carry a code and a path', () => {
  function issueFor(spec: ModularGameSpec) {
    try {
      assembleModule(spec, 'high-card');
    } catch (err) {
      if (err instanceof CompileError) return err.issues;
      throw err;
    }
    throw new Error('expected assembleModule to throw');
  }

  const invalid = CompileCode.InvalidSpec;
  const cases: [string, (p: ReturnType<typeof parts>) => void, string, string][] = [
    ['actor { player } with turnOrder', ({ turn }) => { turn.actor = { player: stateRef }; }, `${T}.turnOrder`, invalid],
    ['loop with count and endCondition', ({ loop }) => { loop.endCondition = 'true'; }, L, invalid],
    ['finalRound without checkAfter: turn', ({ loop }) => { delete loop.count; loop.endCondition = 'any(players, player.property.score >= 2)'; loop.finalRound = true; }, `${L}.finalRound`, invalid],
    ['actor in an iteration-checked endCondition', ({ loop }) => { delete loop.count; loop.endCondition = 'actor.property.score >= 2'; }, `${L}.endCondition`, invalid],
    ['ranking property that is not player.property', ({ root }) => { root.winConditions[0].property = 'game.property.x'; }, 'flow.root.winConditions[0].property', invalid],
    ['actor in a condition win rule', ({ root }) => { root.winConditions = [{ rule: 'condition', condition: 'actor.property.score >= 2' }]; }, 'flow.root.winConditions[0].condition', invalid],
    ['input with no effect after it', ({ action }) => { action.steps.push({ input: 'extra', type: { kind: 'boolean' } }); }, 'actions.actions[0]', invalid],
    ['more than four player inputs', ({ action }) => { action.steps.unshift(...['a', 'b', 'c', 'd'].map((id) => ({ input: id, type: { kind: 'boolean' } }))); }, 'actions.actions[0]', CompileCode.Limit],
  ];

  it.each(cases)('%s', (_name, patch, path, code) => {
    const spec = loadExample('high-card.yaml');
    patch(parts(spec));
    expect(issueFor(spec)).toEqual([expect.objectContaining({ code, path })]);
  });
});
