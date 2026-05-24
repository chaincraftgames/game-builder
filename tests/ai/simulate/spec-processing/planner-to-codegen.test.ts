/**
 * Planner → Codegen Direct Path — Proof Tests
 *
 * Proves that MechanicTargets built directly from planner hints
 * (AutomaticTransitionHint / PhaseInstructionsHint) produce valid
 * TypeScript that passes tsc and executes correctly in the sandbox.
 *
 * Three scenarios:
 *   1. Deterministic transition (pure logic, no LLM/RNG)
 *   2. Transition with rollDice (auditable RNG)
 *   3. Transition with callLLM (narrative generation)
 *
 * No real LLM calls — the model is mocked to return hand-crafted code.
 */

import { jest, describe, it, expect } from '@jest/globals';
import type { ModelWithOptions } from '#chaincraft/ai/model-config.js';
import { buildTargetsFromHints } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/target-builder.js';
import { generateAndValidateMechanic } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/mechanic-generator.js';
import { validateMechanics } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/tsc-validator.js';
import {
  generateStateInterfaces,
  type GameStateField,
} from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/generate-state-interfaces.js';
import { executeMechanic, prepareMechanicBody } from '#chaincraft/ai/simulate/mechanic-sandbox.js';
import type {
  AutomaticTransitionHint,
  PhaseInstructionsHint,
} from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-instructions/schema.js';

// ---------------------------------------------------------------------------
// Schema fixtures — Liar's Dice subset
// ---------------------------------------------------------------------------

const LIARS_DICE_FIELDS: GameStateField[] = [
  { name: 'currentPhase', type: 'string', path: 'game', purpose: 'Current game phase' },
  { name: 'currentBidQuantity', type: 'number', path: 'game', purpose: 'Current bid quantity' },
  { name: 'currentBidFace', type: 'number', path: 'game', purpose: 'Current bid face value' },
  { name: 'currentBidder', type: 'string', path: 'game', purpose: 'Who placed current bid' },
  { name: 'roundNumber', type: 'number', path: 'game', purpose: 'Current round' },
  { name: 'gameEnded', type: 'boolean', path: 'game', purpose: 'Whether game has ended' },
  { name: 'winner', type: 'string', path: 'game', purpose: 'Winner player alias' },
  { name: 'diceCount', type: 'number', path: 'player', purpose: 'Number of dice remaining' },
  { name: 'dice', type: 'array', valueType: 'number', path: 'player', purpose: 'Current dice values' },
  { name: 'eliminated', type: 'boolean', path: 'player', purpose: 'Whether player is eliminated' },
];

const STATE_INTERFACES = generateStateInterfaces(LIARS_DICE_FIELDS);

// ---------------------------------------------------------------------------
// Planner hint fixtures
// ---------------------------------------------------------------------------

const ROLL_DICE_TRANSITION: AutomaticTransitionHint = {
  id: 'roll_dice',
  transitionName: 'Roll Dice',
  mechanicsDescription:
    'Roll fresh dice for each non-eliminated player. Each player gets diceCount dice with values 1-6.',
  requiresLLMReasoning: false,
  usesRandomness: true,
  randomnessDescription: 'Roll diceCount d6 for each player using rollDice(1, 6).',
  publicMessagePurpose: 'Announce that dice have been rolled for a new round.',
};

const RESOLVE_CHALLENGE_TRANSITION: AutomaticTransitionHint = {
  id: 'resolve_challenge',
  transitionName: 'Resolve Challenge',
  mechanicsDescription:
    'Count ALL dice across all players matching the current bid face. ' +
    'If count >= bidQuantity, challenger loses a die. Otherwise, bidder loses a die. ' +
    'If a player reaches 0 dice, they are eliminated. ' +
    'If only one player remains, they win.',
  requiresLLMReasoning: false,
  usesRandomness: false,
  publicMessagePurpose: 'Announce challenge result with total count and who lost a die.',
  privateMessagesPurpose: 'Tell each player their remaining dice count.',
};

const NARRATIVE_TRANSITION: AutomaticTransitionHint = {
  id: 'announce_round',
  transitionName: 'Announce Round',
  mechanicsDescription:
    'Generate a dramatic narrative announcement for the start of a new bidding round. ' +
    'Use callLLM to create flavor text. Increment roundNumber.',
  requiresLLMReasoning: true,
  usesRandomness: false,
  publicMessagePurpose: 'Dramatic announcement of the new round.',
};

const BID_ACTION_PHASE: PhaseInstructionsHint = {
  phase: 'bidding',
  phaseSummary: 'Players take turns bidding or challenging',
  playerActions: [
    {
      id: 'place_bid',
      actionName: 'Place Bid',
      mechanicsDescription:
        'Validate that the new bid is strictly higher than the current bid ' +
        '(higher quantity, or same quantity with higher face value). ' +
        'Update currentBidQuantity, currentBidFace, and currentBidder.',
      requiresLLMValidation: false,
    },
    {
      id: 'pass_turn',
      actionName: 'Pass Turn',
      mechanicsDescription: null, // No code generation needed
      requiresLLMValidation: false,
    },
  ],
};

// ---------------------------------------------------------------------------
// Hand-crafted mechanic code (what a real LLM would produce)
// ---------------------------------------------------------------------------

/** roll_dice: Uses rollDice for each non-eliminated player */
const ROLL_DICE_CODE = `
export async function roll_dice(
  state: MechanicState,
  callLLM: CallLLM,
  rollDice: RollDice
): Promise<MechanicResult> {
  const result = {
    game: { roundNumber: state.game.roundNumber + 1 },
    publicMessage: "Dice have been rolled for a new round!",
  } as MechanicResult;

  // Roll dice for each non-eliminated player
  const playerKeys = Object.keys(state).filter(k => k.startsWith("player")) as \`player\${number}\`[];
  for (const pk of playerKeys) {
    const player = state[pk];
    if (player.eliminated) continue;
    const newDice: number[] = [];
    for (let i = 0; i < player.diceCount; i++) {
      newDice.push(rollDice(1, 6));
    }
    result[pk] = { dice: newDice };
  }

  return result;
}
`;

/** resolve_challenge: Pure deterministic logic */
const RESOLVE_CHALLENGE_CODE = `
export async function resolve_challenge(
  state: MechanicState,
  callLLM: CallLLM,
  rollDice: RollDice
): Promise<MechanicResult> {
  const bidFace = state.game.currentBidFace;
  const bidQty = state.game.currentBidQuantity;
  const bidder = state.game.currentBidder;

  // Count all dice matching bid face across all players
  let totalMatch = 0;
  const playerKeys = Object.keys(state).filter(k => k.startsWith("player")) as \`player\${number}\`[];
  for (const pk of playerKeys) {
    const player = state[pk];
    if (!player.eliminated) {
      totalMatch += player.dice.filter((d: number) => d === bidFace).length;
    }
  }

  // Determine loser: if count >= bid, challenger loses; otherwise bidder loses
  const challenger = playerKeys.find(pk => pk !== bidder) || playerKeys[0];
  const loser = totalMatch >= bidQty ? challenger : (bidder as \`player\${number}\`);

  const loserPlayer = state[loser];
  const newDiceCount = loserPlayer.diceCount - 1;
  const eliminated = newDiceCount <= 0;

  // Check for winner
  const activePlayers = playerKeys.filter(pk => {
    if (pk === loser) return !eliminated;
    return !state[pk].eliminated;
  });
  const gameEnded = activePlayers.length <= 1;
  const winner = gameEnded ? activePlayers[0] || "" : "";

  // Build result incrementally to avoid computed-key type widening
  const result = {
    game: {
      gameEnded,
      winner,
    },
    publicMessage: \`Challenge! There were \${totalMatch} dice showing \${bidFace}. \${loser} loses a die!\`,
    privateMessages: {} as Record<string, string>,
  } as MechanicResult;

  result[loser] = {
    diceCount: newDiceCount,
    eliminated,
  };

  // Send private messages to each player
  for (const pk of playerKeys) {
    const count = pk === loser ? newDiceCount : state[pk].diceCount;
    result.privateMessages![pk] = \`You have \${count} dice remaining.\`;
  }

  return result;
}
`;

/** announce_round: Uses callLLM for narrative text */
const ANNOUNCE_ROUND_CODE = `
export async function announce_round(
  state: MechanicState,
  callLLM: CallLLM,
  rollDice: RollDice
): Promise<MechanicResult> {
  const narrative = await callLLM(
    "Generate a dramatic 1-2 sentence announcement for round " +
    (state.game.roundNumber + 1) + " of Liar's Dice. " +
    "Keep it exciting and thematic."
  );

  return {
    game: { roundNumber: state.game.roundNumber + 1 },
    publicMessage: narrative,
  };
}
`;

/** place_bid: Player action with validation logic */
const PLACE_BID_CODE = `
export async function place_bid(
  state: MechanicState,
  callLLM: CallLLM,
  rollDice: RollDice
): Promise<MechanicResult> {
  // In a real scenario, the action payload would carry the new bid values.
  // For this mechanic, we demonstrate the validation pattern:
  // the generated code would validate against state and return updates.
  const newQuantity = state.game.currentBidQuantity + 1;
  const newFace = state.game.currentBidFace;

  return {
    game: {
      currentBidQuantity: newQuantity,
      currentBidFace: newFace,
      currentBidder: "player1",
    },
  };
}
`;

// ---------------------------------------------------------------------------
// Mock model
// ---------------------------------------------------------------------------

function createMockModel(codeByTargetId: Record<string, string>): ModelWithOptions {
  return {
    model: {} as any,
    modelName: 'mock-model',
    invokeWithSystemPrompt: jest.fn(async (_system: string, _user: string, meta: any) => {
      const id = meta?.mechanicId;
      const code = codeByTargetId[id];
      if (!code) throw new Error(`No mock code for mechanic: ${id}`);
      return { content: code };
    }),
    invoke: jest.fn(),
    invokeWithMessages: jest.fn(),
    getCallbacks: () => [],
  } as unknown as ModelWithOptions;
}

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

function makeLiarsDiceState() {
  return {
    game: {
      currentPhase: 'bidding',
      currentBidQuantity: 3,
      currentBidFace: 4,
      currentBidder: 'player1',
      roundNumber: 1,
      gameEnded: false,
      winner: '',
    },
    player1: {
      diceCount: 5,
      dice: [1, 3, 4, 4, 6],
      eliminated: false,
    },
    player2: {
      diceCount: 5,
      dice: [2, 4, 4, 5, 6],
      eliminated: false,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Planner → Codegen Direct Path', () => {
  // ─── 1. Target building from hints ────────────────────────────────────────

  describe('buildTargetsFromHints', () => {
    it('builds targets from transition hints with mechanicsDescription', () => {
      const targets = buildTargetsFromHints(
        [ROLL_DICE_TRANSITION, RESOLVE_CHALLENGE_TRANSITION],
        [],
      );

      expect(targets).toHaveLength(2);
      expect(targets[0].id).toBe('roll_dice');
      expect(targets[0].type).toBe('transition');
      expect(targets[0].instructions).toContain('Roll fresh dice');
      // Randomness guidance appended
      expect(targets[0].instructions).toContain('Randomness: Roll diceCount d6');
    });

    it('builds targets from player action hints', () => {
      const targets = buildTargetsFromHints([], [BID_ACTION_PHASE]);

      // pass_turn has null mechanicsDescription → excluded
      expect(targets).toHaveLength(1);
      expect(targets[0].id).toBe('place_bid');
      expect(targets[0].type).toBe('action');
      expect(targets[0].instructions).toContain('Validate that the new bid');
    });

    it('skips transitions without mechanicsDescription', () => {
      const noMechanics: AutomaticTransitionHint = {
        id: 'simple_advance',
        transitionName: 'Advance Phase',
        mechanicsDescription: null,
        requiresLLMReasoning: false,
        usesRandomness: false,
      };
      const targets = buildTargetsFromHints([noMechanics], []);
      expect(targets).toHaveLength(0);
    });

    it('includes message guidance from hint purpose strings', () => {
      const targets = buildTargetsFromHints(
        [RESOLVE_CHALLENGE_TRANSITION],
        [],
      );
      expect(targets[0].messageGuidance).toContain('Public message:');
      expect(targets[0].messageGuidance).toContain('Private messages:');
    });
  });

  // ─── 2. TSC validation of hand-crafted code ──────────────────────────────

  describe('tsc validation — planner-hint-driven mechanics', () => {
    it('validates rollDice-using code against state interfaces', () => {
      const result = validateMechanics(STATE_INTERFACES, {
        roll_dice: ROLL_DICE_CODE,
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates deterministic code against state interfaces', () => {
      const result = validateMechanics(STATE_INTERFACES, {
        resolve_challenge: RESOLVE_CHALLENGE_CODE,
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates callLLM-using code against state interfaces', () => {
      const result = validateMechanics(STATE_INTERFACES, {
        announce_round: ANNOUNCE_ROUND_CODE,
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates player action code against state interfaces', () => {
      const result = validateMechanics(STATE_INTERFACES, {
        place_bid: PLACE_BID_CODE,
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates ALL mechanics together (cross-file)', () => {
      const result = validateMechanics(STATE_INTERFACES, {
        roll_dice: ROLL_DICE_CODE,
        resolve_challenge: RESOLVE_CHALLENGE_CODE,
        announce_round: ANNOUNCE_ROUND_CODE,
        place_bid: PLACE_BID_CODE,
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // ─── 3. Full pipeline: hints → targets → LLM (mock) → tsc → sandbox ────

  describe('full pipeline — hints through sandbox execution', () => {
    it('rollDice transition: generates, validates, and executes', async () => {
      // Build targets from planner hints
      const targets = buildTargetsFromHints([ROLL_DICE_TRANSITION], []);
      expect(targets).toHaveLength(1);

      // Mock LLM returns hand-crafted code
      const model = createMockModel({ roll_dice: ROLL_DICE_CODE });
      const genResult = await generateAndValidateMechanic(
        model,
        targets[0],
        STATE_INTERFACES,
      );

      expect(genResult.valid).toBe(true);
      expect(genResult.code).toContain('rollDice(1, 6)');

      // Execute in sandbox with a seeded rollDice
      let rollCount = 0;
      const seededRolls = [3, 1, 5, 2, 6, 4, 2, 5, 1, 3]; // Predetermined
      const mockRollDice = (min: number, max: number) => {
        expect(min).toBe(1);
        expect(max).toBe(6);
        return seededRolls[rollCount++];
      };
      const mockCallLLM = jest.fn(async () => 'unused');

      const state = makeLiarsDiceState();
      const result = await executeMechanic(genResult.code, state, mockCallLLM, mockRollDice);

      // Verify RNG was actually called (5 dice per player = 10 calls)
      expect(rollCount).toBe(10);

      // Verify result structure
      expect(result.game).toBeDefined();
      expect(result.game.roundNumber).toBe(2);
      expect(result.player1).toBeDefined();
      expect(result.player1.dice).toHaveLength(5);
      expect(result.player1.dice).toEqual([3, 1, 5, 2, 6]);
      expect(result.player2.dice).toEqual([4, 2, 5, 1, 3]);

      // callLLM was NOT called (RNG-only mechanic)
      expect(mockCallLLM).not.toHaveBeenCalled();
    });

    it('callLLM transition: generates, validates, and executes', async () => {
      const targets = buildTargetsFromHints([NARRATIVE_TRANSITION], []);
      expect(targets).toHaveLength(1);

      const model = createMockModel({ announce_round: ANNOUNCE_ROUND_CODE });
      const genResult = await generateAndValidateMechanic(
        model,
        targets[0],
        STATE_INTERFACES,
      );

      expect(genResult.valid).toBe(true);
      expect(genResult.code).toContain('callLLM');

      // Execute in sandbox with mock callLLM
      const mockCallLLM = jest.fn(async (prompt: string) => {
        expect(prompt).toContain('round 2');
        return 'The dice clatter across the table as Round 2 begins!';
      });
      const mockRollDice = jest.fn((_min: number, _max: number) => 1);

      const state = makeLiarsDiceState();
      const result = await executeMechanic(genResult.code, state, mockCallLLM, mockRollDice);

      // callLLM WAS called
      expect(mockCallLLM).toHaveBeenCalledTimes(1);
      // rollDice was NOT called
      expect(mockRollDice).not.toHaveBeenCalled();

      expect(result.game.roundNumber).toBe(2);
      expect(result.publicMessage).toContain('Round 2');
    });

    it('deterministic transition: generates, validates, and executes', async () => {
      const targets = buildTargetsFromHints([RESOLVE_CHALLENGE_TRANSITION], []);
      const model = createMockModel({ resolve_challenge: RESOLVE_CHALLENGE_CODE });
      const genResult = await generateAndValidateMechanic(
        model,
        targets[0],
        STATE_INTERFACES,
      );

      expect(genResult.valid).toBe(true);

      const mockCallLLM = jest.fn(async () => 'unused');
      const mockRollDice = jest.fn((_min: number, _max: number) => 1);

      // State: bid is 3x face-4. player1 has [1,3,4,4,6], player2 has [2,4,4,5,6]
      // Total 4s: player1 has 2, player2 has 2 = 4 total. Bid was 3.
      // 4 >= 3 → challenger loses. bidder is player1, so challenger is player2.
      const state = makeLiarsDiceState();
      const result = await executeMechanic(genResult.code, state, mockCallLLM, mockRollDice);

      // Neither callLLM nor rollDice called
      expect(mockCallLLM).not.toHaveBeenCalled();
      expect(mockRollDice).not.toHaveBeenCalled();

      // Challenger (player2) loses a die
      expect(result.player2.diceCount).toBe(4);
      expect(result.player2.eliminated).toBe(false);
      expect(result.publicMessage).toContain('player2 loses a die');
      expect(result.privateMessages).toBeDefined();
    });

    it('player action: generates, validates, and executes', async () => {
      const targets = buildTargetsFromHints([], [BID_ACTION_PHASE]);
      expect(targets).toHaveLength(1);
      expect(targets[0].id).toBe('place_bid');

      const model = createMockModel({ place_bid: PLACE_BID_CODE });
      const genResult = await generateAndValidateMechanic(
        model,
        targets[0],
        STATE_INTERFACES,
      );

      expect(genResult.valid).toBe(true);

      const state = makeLiarsDiceState();
      const mockCallLLM = jest.fn(async () => 'unused');
      const mockRollDice = jest.fn((_min: number, _max: number) => 1);

      const result = await executeMechanic(genResult.code, state, mockCallLLM, mockRollDice);

      // Bid quantity incremented
      expect(result.game.currentBidQuantity).toBe(4);
      expect(result.game.currentBidFace).toBe(4);
      expect(result.game.currentBidder).toBe('player1');
    });
  });
});


