// ---------------------------------------------------------------------------
// Expression compiler — table-driven tests
//
// Tests the full pipeline: input string → tokenize → parse → evaluate
// against synthetic EvalContext snapshots.
// ---------------------------------------------------------------------------

import { compileExpression, compilePredicate, parseExpression, ExpressionError, referencedInputs } from '../index.js';
import type { EvalContext } from '../index.js';

// --- Test helpers -----------------------------------------------------------

/** Minimal context with game properties and two players. */
function makeCtx(overrides?: Partial<EvalContext>): EvalContext {
  return {
    gameProperties: { tricksPlayed: 3, winner: 'alice', roundWinner: '' },
    gameInventories: {
      deck: { pieceIds: [] },
      table: { pieceIds: ['card-1', 'card-5'] },
      discard: { pieceIds: ['card-2', 'card-3', 'card-4', 'card-6'] },
    },
    players: {
      alice: {
        properties: { score: 2, ready: true, eliminated: false },
        inventories: { hand: { pieceIds: ['card-1'] } },
      },
      bob: {
        properties: { score: 1, ready: true, eliminated: false },
        inventories: { hand: { pieceIds: [] } },
      },
    },
    gamepieces: {
      'card-1': { typeId: 'card', properties: { value: 1 } },
      'card-5': { typeId: 'card', properties: { value: 5 } },
    },
    playerIds: ['alice', 'bob'],
    actorId: 'alice',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Literals & paths
// ---------------------------------------------------------------------------

describe('literals', () => {
  it.each([
    ['42', 42],
    ['-7', -7],
    ['3.14', 3.14],
    ['"hello"', 'hello'],
    ["'world'", 'world'],
    ['true', true],
    ['false', false],
  ])('evaluates %s → %p', (input, expected) => {
    const fn = compileExpression(input);
    expect(fn(makeCtx())).toBe(expected);
  });
});

describe('path resolution', () => {
  const ctx = makeCtx();

  it('resolves game.property.X', () => {
    expect(compileExpression('game.property.tricksPlayed')(ctx)).toBe(3);
    expect(compileExpression('game.property.winner')(ctx)).toBe('alice');
    expect(compileExpression('game.property.roundWinner')(ctx)).toBe('');
  });

  it('resolves actor.property.X', () => {
    expect(compileExpression('actor.property.score')(ctx)).toBe(2);
  });

  it('resolves actor.property for different actors', () => {
    const bobCtx = makeCtx({ actorId: 'bob' });
    expect(compileExpression('actor.property.score')(bobCtx)).toBe(1);
  });

  it('resolves game.inventory.X (returns inventory object)', () => {
    const inv = compileExpression('game.inventory.deck')(ctx);
    expect(inv).toEqual({ pieceIds: [] });
  });

  it('resolves actor.inventory.X', () => {
    const inv = compileExpression('actor.inventory.hand')(ctx);
    expect(inv).toEqual({ pieceIds: ['card-1'] });
  });

  it('returns undefined for missing properties', () => {
    expect(compileExpression('game.property.nonexistent')(ctx)).toBeUndefined();
  });

  it('throws on unknown root', () => {
    expect(() => compileExpression('foo.property.x')(ctx)).toThrow(ExpressionError);
  });

  it('throws on missing actorId', () => {
    const noActor = makeCtx({ actorId: undefined });
    expect(() => compileExpression('actor.property.score')(noActor)).toThrow('no actorId');
  });

  it("resolves input.X and its param.X alias from action inputs", () => {
    const withInputs = makeCtx({ params: { quantity: 4 } });
    expect(compileExpression("input.quantity")(withInputs)).toBe(4);
    expect(compileExpression("param.quantity")(withInputs)).toBe(4);
  });

  it("throws on input.X when no action inputs are in context", () => {
    expect(() => compileExpression("input.quantity")(ctx)).toThrow("no action inputs");
  });
});

describe("referencedInputs", () => {
  it("collects input and param references once each, including inside calls", () => {
    expect(
      referencedInputs(
        "input.a > game.property.x or (param.b == 2 and any(players, player.property.s > input.a))",
      ).sort(),
    ).toEqual(["a", "b"]);
  });

  it("returns nothing when no inputs are read", () => {
    expect(referencedInputs("actor.property.score >= 3")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Comparison operators
// ---------------------------------------------------------------------------

describe('comparisons', () => {
  const ctx = makeCtx();

  it.each([
    ['game.property.tricksPlayed >= 3', true],
    ['game.property.tricksPlayed > 3', false],
    ['game.property.tricksPlayed == 3', true],
    ['game.property.tricksPlayed != 3', false],
    ['game.property.tricksPlayed <= 3', true],
    ['game.property.tricksPlayed < 3', false],
    ['actor.property.score >= 2', true],
    ['actor.property.score > 2', false],
    ['game.property.winner == "alice"', true],
    ['game.property.winner != "alice"', false],
    ["game.property.roundWinner == ''", true],
  ])('%s → %p', (input, expected) => {
    expect(compilePredicate(input)(ctx)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Logical operators
// ---------------------------------------------------------------------------

describe('logical operators', () => {
  const ctx = makeCtx();

  it.each([
    ['game.property.tricksPlayed >= 3 and actor.property.score >= 2', true],
    ['game.property.tricksPlayed >= 3 and actor.property.score > 2', false],
    ['game.property.tricksPlayed > 3 or actor.property.score >= 2', true],
    ['game.property.tricksPlayed > 3 or actor.property.score > 2', false],
    ['not game.property.tricksPlayed > 3', true],
    ['not game.property.tricksPlayed >= 3', false],
    ['not (game.property.tricksPlayed > 3 or actor.property.score > 2)', true],
  ])('%s → %p', (input, expected) => {
    expect(compilePredicate(input)(ctx)).toBe(expected);
  });

  it('and short-circuits', () => {
    // false and <anything> should not evaluate the right side
    const pred = compilePredicate('false and actor.property.nonexistent > 0');
    expect(pred(makeCtx())).toBe(false);
  });

  it('or short-circuits', () => {
    const pred = compilePredicate('true or actor.property.nonexistent > 0');
    expect(pred(makeCtx())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

describe('arithmetic', () => {
  const ctx = makeCtx();

  it.each([
    ['2 + 3', 5],
    ['10 - 4', 6],
    ['3 * 7', 21],
    ['10 / 2', 5],
    ['actor.property.score + 1', 3],
    ['actor.property.score * 2', 4],
  ])('%s → %p', (input, expected) => {
    expect(compileExpression(input)(ctx)).toBe(expected);
  });

  it('division by zero returns 0', () => {
    expect(compileExpression('10 / 0')(makeCtx())).toBe(0);
  });

  it('arithmetic in comparison', () => {
    expect(compilePredicate('actor.property.score + 1 >= 3')(ctx)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// count() function
// ---------------------------------------------------------------------------

describe('count()', () => {
  const ctx = makeCtx();

  it('counts game inventory (bag/stack)', () => {
    expect(compileExpression('count(game.inventory.deck)')(ctx)).toBe(0);
    expect(compileExpression('count(game.inventory.table)')(ctx)).toBe(2);
    expect(compileExpression('count(game.inventory.discard)')(ctx)).toBe(4);
  });

  it('counts actor inventory', () => {
    expect(compileExpression('count(actor.inventory.hand)')(ctx)).toBe(1);
    const bobCtx = makeCtx({ actorId: 'bob' });
    expect(compileExpression('count(actor.inventory.hand)')(bobCtx)).toBe(0);
  });

  it('works in comparisons', () => {
    expect(compilePredicate('count(actor.inventory.hand) == 1')(ctx)).toBe(true);
    expect(compilePredicate('count(actor.inventory.hand) > 0')(ctx)).toBe(true);
    expect(compilePredicate('count(game.inventory.deck) == 0')(ctx)).toBe(true);
  });

  it('counts line inventory (non-null slots)', () => {
    const lineCtx = makeCtx({
      gameInventories: {
        ...makeCtx().gameInventories,
        board: { slots: ['piece-1', null, 'piece-2', null, null] },
      },
    });
    expect(compileExpression('count(game.inventory.board)')(lineCtx)).toBe(2);
  });

  it('returns 0 for null/undefined', () => {
    expect(compileExpression('count(game.inventory.nonexistent)')(ctx)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// all() / any() quantifiers
// ---------------------------------------------------------------------------

describe('all() and any()', () => {
  it('all() — true when all players match', () => {
    const ctx = makeCtx(); // both ready: true
    expect(compilePredicate('all(player.property.ready == true)')(ctx)).toBe(true);
  });

  it('all() — false when one player does not match', () => {
    const ctx = makeCtx();
    ctx.players.bob.properties.ready = false;
    expect(compilePredicate('all(player.property.ready == true)')(ctx)).toBe(false);
  });

  it('any() — true when at least one player matches', () => {
    const ctx = makeCtx();
    ctx.players.bob.properties.eliminated = true;
    expect(compilePredicate('any(player.property.eliminated == true)')(ctx)).toBe(true);
  });

  it('any() — false when no player matches', () => {
    const ctx = makeCtx(); // both eliminated: false
    expect(compilePredicate('any(player.property.eliminated == true)')(ctx)).toBe(false);
  });

  it('nested count inside quantifier', () => {
    // "any player has an empty hand"
    const ctx = makeCtx(); // bob has 0 cards
    expect(compilePredicate('any(count(player.inventory.hand) == 0)')(ctx)).toBe(true);
    // "all players have an empty hand" — alice still has 1
    expect(compilePredicate('all(count(player.inventory.hand) == 0)')(ctx)).toBe(false);
  });
});

describe('countPlayers()', () => {
  it('counts players for whom the predicate holds', () => {
    const ctx = makeCtx();
    expect(compileExpression('countPlayers(not player.property.eliminated)')(ctx)).toBe(2);
    ctx.players.bob.properties.eliminated = true;
    expect(compileExpression('countPlayers(not player.property.eliminated)')(ctx)).toBe(1);
  });

  it('works in comparisons', () => {
    const ctx = makeCtx();
    expect(compilePredicate('countPlayers(player.property.score >= 2) == 1')(ctx)).toBe(true);
  });

  it('rejects wrong arity', () => {
    expect(() => compileExpression('countPlayers()')).toThrow('countPlayers() expects exactly 1 argument');
  });
});

// ---------------------------------------------------------------------------
// Compound expressions (Liar's Dice style)
// ---------------------------------------------------------------------------

describe('compound expressions', () => {
  it('bid validation shape', () => {
    const ctx = makeCtx({
      params: { bidQuantity: 3, bidFace: 4, prevQuantity: 2, prevFace: 3 },
    });
    const expr = 'param.bidQuantity >= param.prevQuantity and param.bidFace >= param.prevFace';
    expect(compilePredicate(expr)(ctx)).toBe(true);
  });

  it('bid validation — quantity too low', () => {
    const ctx = makeCtx({
      params: { bidQuantity: 1, bidFace: 4, prevQuantity: 2, prevFace: 3 },
    });
    const expr = 'param.bidQuantity >= param.prevQuantity and param.bidFace >= param.prevFace';
    expect(compilePredicate(expr)(ctx)).toBe(false);
  });

  it('end condition: score threshold', () => {
    const ctx = makeCtx();
    expect(compilePredicate('any(player.property.score >= 2)')(ctx)).toBe(true); // alice has 2
    expect(compilePredicate('any(player.property.score >= 5)')(ctx)).toBe(false);
  });

  it('combined game + actor conditions', () => {
    const ctx = makeCtx();
    const expr = 'game.property.tricksPlayed >= 3 and actor.property.score >= 2';
    expect(compilePredicate(expr)(ctx)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Parenthesized expressions
// ---------------------------------------------------------------------------

describe('parentheses', () => {
  it('overrides precedence', () => {
    // Without parens: false and true or true → (false and true) or true → true
    // With parens: false and (true or true) → false and true → false
    expect(compilePredicate('false and (true or true)')(makeCtx())).toBe(false);
    expect(compilePredicate('false and true or true')(makeCtx())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Parser / tokenizer error reporting
// ---------------------------------------------------------------------------

describe('error reporting', () => {
  it('rejects unterminated strings', () => {
    expect(() => compileExpression('"unterminated')).toThrow(ExpressionError);
  });

  it('rejects unexpected characters', () => {
    expect(() => compileExpression('foo @ bar')).toThrow(ExpressionError);
  });

  it('rejects trailing tokens', () => {
    expect(() => compileExpression('3 4')).toThrow(ExpressionError);
  });

  it('rejects empty input', () => {
    expect(() => compileExpression('')).toThrow();
  });

  it('rejects unknown function', () => {
    expect(() => compileExpression('unknown(1)')).toThrow(ExpressionError);
  });

  it('rejects count with wrong arity', () => {
    expect(() => compileExpression('count(a, b)')).toThrow(ExpressionError);
  });

  it('rejects player outside quantifier', () => {
    const fn = compileExpression('player.property.score');
    expect(() => fn(makeCtx())).toThrow('"player" requires boundPlayerId in context');
  });
});

// ---------------------------------------------------------------------------
// source / target piece paths
// ---------------------------------------------------------------------------

describe('source and target piece paths', () => {
  const ctx = makeCtx({
    sourcePieceId: 'card-1',
    targetPieceId: 'card-5',
  });

  it('resolves source.property.X', () => {
    expect(compileExpression('source.property.value')(ctx)).toBe(1);
  });

  it('resolves target.property.X', () => {
    expect(compileExpression('target.property.value')(ctx)).toBe(5);
  });

  it('source - target arithmetic', () => {
    expect(compileExpression('source.property.value - target.property.value')(ctx)).toBe(-4);
  });

  it('throws when sourcePieceId is absent', () => {
    expect(() => compileExpression('source.property.value')(makeCtx())).toThrow('sourcePieceId');
  });

  it('throws when targetPieceId is absent', () => {
    expect(() => compileExpression('target.property.value')(makeCtx())).toThrow('targetPieceId');
  });
});

describe("candidate id paths", () => {
  it("resolves piece.id to the filtered piece", () => {
    const ctx = makeCtx({ targetPieceId: "card-5", params: { attacker: "card-1" } });
    expect(compileExpression("piece.id")(ctx)).toBe("card-5");
    expect(compilePredicate("piece.id != input.attacker")(ctx)).toBe(true);
  });

  it("resolves player.id to the bound player", () => {
    expect(compileExpression("player.id")(makeCtx({ boundPlayerId: "bob" }))).toBe("bob");
  });
});

// ---------------------------------------------------------------------------
// trigger paths (passive effects)
// ---------------------------------------------------------------------------

describe('trigger paths', () => {
  const ctx = makeCtx({
    trigger: {
      path: 'player.property.life',
      previousValue: 30,
      newValue: 25,
      delta: -5,
      direction: 'decrease',
      targetId: 'p2',
    },
  });

  it('resolves trigger.delta', () => {
    expect(compileExpression('trigger.delta')(ctx)).toBe(-5);
  });

  it('resolves trigger.previousValue and trigger.newValue', () => {
    expect(compileExpression('trigger.previousValue')(ctx)).toBe(30);
    expect(compileExpression('trigger.newValue')(ctx)).toBe(25);
  });

  it('supports arithmetic on trigger fields', () => {
    expect(compileExpression('0 - trigger.delta')(ctx)).toBe(5);
  });

  it('throws when trigger is absent', () => {
    expect(() => compileExpression('trigger.delta')(makeCtx())).toThrow('trigger');
  });
});

// ---------------------------------------------------------------------------
// AST inspection (parseExpression)
// ---------------------------------------------------------------------------

describe('parseExpression', () => {
  it('returns a path node', () => {
    const ast = parseExpression('game.property.score');
    expect(ast).toEqual({ kind: 'path', segments: ['game', 'property', 'score'] });
  });

  it('returns a comparison node', () => {
    const ast = parseExpression('game.property.score >= 3');
    expect(ast.kind).toBe('compare');
  });

  it('returns a call node for count()', () => {
    const ast = parseExpression('count(game.inventory.deck)');
    expect(ast.kind).toBe('call');
    if (ast.kind === 'call') {
      expect(ast.fn).toBe('count');
      expect(ast.args).toHaveLength(1);
    }
  });
});
