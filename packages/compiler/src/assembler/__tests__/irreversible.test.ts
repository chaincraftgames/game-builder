import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { load } from 'js-yaml';
import { validate } from '@chaincraft/gamedef/validator';
import type { GameConfig, InventoryConfig, PassiveActivation } from '@chaincraft/runtime';
import { assembleModule, classifyIrreversibleEffects } from '../index.js';

const inv = (over: Partial<InventoryConfig>): InventoryConfig => ({
  structure: 'none',
  scope: 'game',
  visibility: 'always',
  countVisibility: 'always',
  accepts: ['card'],
  ...over,
});

const config = {
  inventories: {
    boardA: inv({}),
    boardB: inv({}),
    deck: inv({ visibility: 'never', structure: 'stack' }),
    topDeck: inv({ visibility: 'top-revealed', structure: 'stack' }),
    faceA: inv({ visibility: 'revealed' }),
    faceB: inv({ visibility: 'revealed' }),
    handA: inv({ scope: 'player', visibility: 'owner' }),
    handB: inv({ scope: 'player', visibility: 'owner' }),
    teamStash: inv({ scope: 'team', visibility: 'owner' }),
  },
  gameProperties: {
    score: { mutable: true },
    derived: { mutable: false, computed: { expr: 'count(actor.inventory.handA)' } },
  },
  playerProperties: { hp: { mutable: true } },
} as unknown as GameConfig;

const classify = (defs: Record<string, Record<string, unknown>>, passives: PassiveActivation[] = []) =>
  classifyIrreversibleEffects(defs, config, passives);

const move = (from: Record<string, unknown>, to: Record<string, unknown>) => ({ kind: 'move', from, to });

describe('classifyIrreversibleEffects — kinds', () => {
  it.each(['shuffle', 'roll', 'flip', 'reveal', 'hide', 'message', 'custom', 'llm-effect',
    'cancel-effect', 'adjust', 'chaincraft:dominant-gamepiece'])('%s is irreversible', (kind) => {
    expect(classify({ e: { kind } })).toEqual(['e']);
  });

  it('orient is reversible', () => {
    expect(classify({ e: { kind: 'orient', pieces: {}, to: 'rotate-cw' } })).toEqual([]);
  });

  it('returns sorted ids', () => {
    expect(classify({ b: { kind: 'shuffle' }, a: { kind: 'roll' } })).toEqual(['a', 'b']);
  });
});

describe('classifyIrreversibleEffects — move', () => {
  it('between inventories with identical viewers is reversible', () => {
    expect(classify({ e: move({ inventory: 'boardA', select: 'top' }, { inventory: 'boardB' }) })).toEqual([]);
    expect(classify({ e: move({ inventory: 'faceA', select: 'top' }, { inventory: 'faceB' }) })).toEqual([]);
  });

  it('within one owner-visible inventory for the same player is reversible', () => {
    expect(classify({ e: move({ inventory: 'handA', select: 'top' }, { inventory: 'handB' }) })).toEqual([]);
  });

  it('owner-visible to a different player is irreversible', () => {
    const to = { inventory: 'handB', player: { param: 'target' } };
    expect(classify({ e: move({ inventory: 'handA', select: 'top' }, to) })).toEqual(['e']);
  });

  it('owner-visible from a non-literal player reference is irreversible', () => {
    const from = { inventory: 'handA', select: 'top', player: { where: () => true } };
    expect(classify({ e: move(from, { inventory: 'handB' }) })).toEqual(['e']);
  });

  it('hidden to owner-visible (draw) is irreversible', () => {
    expect(classify({ e: move({ inventory: 'deck', select: 'top' }, { inventory: 'handA' }) })).toEqual(['e']);
  });

  it('owner-visible to public (play) is irreversible', () => {
    expect(classify({ e: move({ inventory: 'handA', select: 'top' }, { inventory: 'boardA' }) })).toEqual(['e']);
  });

  it('public to face-dependent visibility is irreversible', () => {
    expect(classify({ e: move({ inventory: 'boardA', select: 'top' }, { inventory: 'faceA' }) })).toEqual(['e']);
  });

  it('top-revealed inventories are irreversible', () => {
    expect(classify({ e: move({ inventory: 'topDeck', select: 'top' }, { inventory: 'topDeck' }) })).toEqual(['e']);
  });

  it('random selection is irreversible', () => {
    expect(classify({ e: move({ inventory: 'boardA', select: 'random' }, { inventory: 'boardB' }) })).toEqual(['e']);
  });

  it('team-scoped owner visibility is irreversible', () => {
    expect(classify({ e: move({ inventory: 'teamStash', select: 'top' }, { inventory: 'teamStash' }) })).toEqual(['e']);
  });

  it('unknown or non-literal inventory is irreversible', () => {
    expect(classify({ e: move({ inventory: 'nope', select: 'top' }, { inventory: 'boardA' }) })).toEqual(['e']);
    expect(classify({ e: move({ inventory: { param: 'x' }, select: 'top' }, { inventory: 'boardA' }) })).toEqual(['e']);
  });
});

describe('classifyIrreversibleEffects — distribute', () => {
  const dist = (from: string, to: string, select = 'top') => ({
    kind: 'distribute',
    from: { inventory: from, select },
    to: { inventory: to },
  });

  it('public to public is reversible', () => {
    expect(classify({ e: dist('boardA', 'boardB') })).toEqual([]);
  });

  it('deal to hands is irreversible', () => {
    expect(classify({ e: dist('deck', 'handA') })).toEqual(['e']);
  });

  it('owner-visible to owner-visible is irreversible (many owners)', () => {
    expect(classify({ e: dist('handA', 'handB') })).toEqual(['e']);
  });

  it('random selection is irreversible', () => {
    expect(classify({ e: dist('boardA', 'boardB', 'random') })).toEqual(['e']);
  });
});

describe('classifyIrreversibleEffects — update / set-state values', () => {
  const setState = (path: string, value: unknown) => ({ kind: 'set-state', path, value });

  it.each([
    ['literal', 5],
    ['delta literal', { delta: 2 }],
    ['mult literal', { mult: 2 }],
    ['toggle', { toggle: true }],
    ['param', { param: 'n' }],
    ['actor', { actor: true }],
    ['public game var', { var: 'game.property.score' }],
    ['delta of public player var', { delta: { var: 'player.property.hp', negate: true } }],
  ])('%s is reversible', (_name, value) => {
    expect(classify({ e: setState('game.property.score', value) })).toEqual([]);
  });

  it.each([
    ['expr', { expr: () => 1 }],
    ['delta expr', { delta: { expr: () => 1 } }],
    ['computed property var', { var: 'game.property.derived' }],
    ['piece property var', { var: 'source.property.secret' }],
    ['unknown property var', { var: 'game.property.missing' }],
    ['random range', { random: { min: 1, max: 6 } }],
    ['random options', { random: { options: [{ value: true }, { value: false }] } }],
  ])('%s is irreversible', (_name, value) => {
    expect(classify({ e: setState('game.property.score', value) })).toEqual(['e']);
    expect(classify({ e: { kind: 'update', pieces: {}, property: 'p', value } })).toEqual(['e']);
  });
});

describe('classifyIrreversibleEffects — passives', () => {
  const passive = (trigger: Record<string, unknown>) =>
    ({ binding: { kind: 'piece', pieceId: 'x' }, trigger }) as unknown as PassiveActivation;
  const defs = {
    setHp: { kind: 'set-state', path: 'player.property.hp', value: 1 },
    setScore: { kind: 'set-state', path: 'game.property.score', value: 1 },
    updPower: { kind: 'update', pieces: {}, property: 'power', value: 1 },
    updOther: { kind: 'update', pieces: {}, property: 'other', value: 1 },
    mv: move({ inventory: 'boardA', select: 'top' }, { inventory: 'boardB' }),
  };

  it('state-write passives mark only effects writing the same path', () => {
    const p = passive({ kind: 'state-write', scope: 'target', path: 'player.property.hp', direction: 'any' });
    expect(classify(defs, [p])).toEqual(['setHp']);
    const q = passive({ kind: 'state-write', scope: 'target', path: 'gamepiece.property.power', direction: 'any' });
    expect(classify(defs, [q])).toEqual(['updPower']);
  });

  it('move passives mark moves', () => {
    expect(classify(defs, [passive({ kind: 'move', scope: 'actor' })])).toEqual(['mv']);
  });

  it('skip-turn passives mark every set-state', () => {
    expect(classify(defs, [passive({ kind: 'skip-turn' })])).toEqual(['setHp', 'setScore']);
  });

  it('no passives leaves them reversible', () => {
    expect(classify(defs)).toEqual([]);
  });
});

describe('assembleModule — irreversibleEffects (High Card)', () => {
  const raw = load(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../gamedef/examples/high-card.yaml'), 'utf-8'),
  );
  const result = validate(raw);
  if (!result.valid) throw new Error('high-card.yaml failed validation');
  const mod = assembleModule(result.spec, 'high-card');
  const irreversible = new Set(mod.irreversibleEffects);

  it('is a subset of effectDefs ids', () => {
    for (const id of irreversible) expect(mod.effectDefs[id]).toBeDefined();
  });

  it('flags shuffle, deal, message, hand-to-table and mechanic effects', () => {
    for (const id of ['shuffleDeck', 'dealCards', 'announceStart', 'announceTrick', 'chaincraft:dominant-gamepiece:resolve']) {
      expect(irreversible.has(id)).toBe(true);
    }
    expect(irreversible.has('playCard._effect_0')).toBe(true);
  });

  it('keeps plain public state writes and public-to-public moves reversible', () => {
    expect(irreversible.has('clearTable')).toBe(false);
    expect(irreversible.has('resetRoundWinner')).toBe(false);
  });
});
