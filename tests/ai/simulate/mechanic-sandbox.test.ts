/**
 * Mechanic Sandbox — Unit Tests
 *
 * Tests executeMechanic() and deepMergeState() with hand-crafted function bodies
 * that match the generation contract. No LLM calls required — callLLM is mocked.
 *
 * Tests both wacky-weapons transitions:
 *   - both_weapons_ready: deterministic weapon→RPS mapping
 *   - resolve_round_outcome: RPS comparison + narrative via callLLM
 */

import { describe, it, expect, jest } from '@jest/globals';
import { executeMechanic, deepMergeState } from '#chaincraft/ai/simulate/mechanic-sandbox.js';

// ─── Realistic function bodies matching the generation contract ───

/**
 * both_weapons_ready: Maps 6 weapon names to RPS types using deterministic
 * hash-based logic, sets weaponMappings, announces via callLLM.
 */
const BOTH_WEAPONS_READY_BODY = `
// Gather all weapon names from both players
const allWeapons = {};
const p1Weapons = Object.keys(state.player1.weapons);
const p2Weapons = Object.keys(state.player2.weapons);
const allNames = [...p1Weapons, ...p2Weapons];

// Deterministic mapping: hash weapon name to RPS type
const rpsTypes = ["rock", "paper", "scissors"];
for (const name of allNames) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  allWeapons[name] = rpsTypes[Math.abs(hash) % 3];
}

// Generate announcement via callLLM
const announcement = await callLLM(
  "Announce that both players have their weapons ready and round 1 is about to begin. " +
  "Keep it to 1 sentence. Return only the announcement text."
);

return {
  game: {
    weaponMappings: allWeapons,
    currentRound: 1,
    publicMessage: announcement,
  },
  player1: {
    actionRequired: true,
  },
  player2: {
    actionRequired: true,
  },
};
`;

/**
 * resolve_round_outcome: Looks up RPS types from weaponMappings,
 * applies RPS rules, increments winner's roundsWon, calls LLM for narrative.
 */
const RESOLVE_ROUND_OUTCOME_BODY = `
// Get selected weapons and their RPS types
const p1Weapon = state.player1.selectedWeapon;
const p2Weapon = state.player2.selectedWeapon;
const p1Type = state.game.weaponMappings[p1Weapon];
const p2Type = state.game.weaponMappings[p2Weapon];

// Apply RPS rules
let winner = null;
if (p1Type === p2Type) {
  winner = "tie";
} else if (
  (p1Type === "rock" && p2Type === "scissors") ||
  (p1Type === "scissors" && p2Type === "paper") ||
  (p1Type === "paper" && p2Type === "rock")
) {
  winner = "player1";
} else {
  winner = "player2";
}

// Build result
const result = { game: {}, player1: {}, player2: {} };

if (winner === "player1") {
  result.player1.roundsWon = state.player1.roundsWon + 1;
  result.player2.roundsWon = state.player2.roundsWon;
} else if (winner === "player2") {
  result.player2.roundsWon = state.player2.roundsWon + 1;
  result.player1.roundsWon = state.player1.roundsWon;
} else {
  result.player1.roundsWon = state.player1.roundsWon;
  result.player2.roundsWon = state.player2.roundsWon;
}

// Generate narrative via callLLM
const narrative = await callLLM(
  "Generate a humorous 1-2 sentence narrative describing the clash between " +
  p1Weapon + " (" + p1Type + ") and " + p2Weapon + " (" + p2Type + "). " +
  "Winner: " + winner + ". " +
  "Return only the narrative text."
);

result.game.roundOutcome = narrative;

return result;
`;

// ─── Test state fixtures ───

function makeAliasedState() {
  return {
    game: {
      currentPhase: 'weapon_setup',
      gameEnded: false,
      currentRound: 0,
      roundOutcome: '',
      weaponMappings: {},
      publicMessage: '',
      publicMessages: [],
    },
    player1: {
      ready: true,
      actionRequired: false,
      illegalActionCount: 0,
      weapons: {
        'Banana Launcher': 'Fires explosive bananas',
        'Rubber Duck Shield': 'Deflects with quacking power',
        'Spaghetti Whip': 'Tangles opponents in pasta',
      },
      roundsWon: 0,
      selectedWeapon: null,
    },
    player2: {
      ready: true,
      actionRequired: false,
      illegalActionCount: 0,
      weapons: {
        'Pillow Cannon': 'Launches fluffy projectiles',
        'Glitter Bomb': 'Blinds with sparkles',
        'Tickle Ray': 'Incapacitates with laughter',
      },
      roundsWon: 0,
      selectedWeapon: null,
    },
  };
}

// ─── Tests ───

describe('executeMechanic — sandbox execution', () => {

  it('both_weapons_ready: generates deterministic weapon mappings', async () => {
    const state = makeAliasedState();
    const mockCallLLM = jest.fn<(prompt: string) => Promise<string>>()
      .mockResolvedValue('Both warriors stand ready — Round 1 begins!');

    const partial = await executeMechanic(BOTH_WEAPONS_READY_BODY, state, mockCallLLM);

    console.log('both_weapons_ready partial:', JSON.stringify(partial, null, 2));

    // Should return weaponMappings for all 6 weapons
    expect(partial.game).toBeDefined();
    expect(partial.game.weaponMappings).toBeDefined();
    const mappings = partial.game.weaponMappings;
    const weaponNames = Object.keys(mappings);
    expect(weaponNames).toHaveLength(6);

    // Every mapping should be rock, paper, or scissors
    const validTypes = new Set(['rock', 'paper', 'scissors']);
    for (const [name, rpsType] of Object.entries(mappings)) {
      expect(validTypes.has(rpsType as string)).toBe(true);
      console.log(`  ${name} → ${rpsType}`);
    }

    // Should be deterministic — running again gives same result
    const partial2 = await executeMechanic(BOTH_WEAPONS_READY_BODY, state, mockCallLLM);
    expect(partial2.game.weaponMappings).toEqual(mappings);
    console.log('✓ Deterministic: second run matches');

    // Should set currentRound and player actionRequired
    expect(partial.game.currentRound).toBe(1);
    expect(partial.player1.actionRequired).toBe(true);
    expect(partial.player2.actionRequired).toBe(true);

    // callLLM should have been called once for announcement
    expect(mockCallLLM).toHaveBeenCalledTimes(2); // once per execution
    expect(partial.game.publicMessage).toBe('Both warriors stand ready — Round 1 begins!');

    console.log('✓ both_weapons_ready passed');
  });

  it('resolve_round_outcome: applies RPS rules correctly (player1 wins)', async () => {
    // Set up state mid-game: player1 has rock-type weapon, player2 has scissors-type
    const state = makeAliasedState();
    state.game.currentPhase = 'round_resolution';
    state.game.currentRound = 1;
    state.game.weaponMappings = {
      'Banana Launcher': 'rock',
      'Rubber Duck Shield': 'paper',
      'Spaghetti Whip': 'scissors',
      'Pillow Cannon': 'scissors',
      'Glitter Bomb': 'rock',
      'Tickle Ray': 'paper',
    };
    state.player1.selectedWeapon = 'Banana Launcher'; // rock
    state.player2.selectedWeapon = 'Pillow Cannon';   // scissors
    state.player1.roundsWon = 0;
    state.player2.roundsWon = 0;

    const mockCallLLM = jest.fn<(prompt: string) => Promise<string>>()
      .mockResolvedValue('The Banana Launcher explodes into Pillow Cannon, sending feathers everywhere!');

    const partial = await executeMechanic(RESOLVE_ROUND_OUTCOME_BODY, state, mockCallLLM);

    console.log('resolve_round_outcome (p1 wins):', JSON.stringify(partial, null, 2));

    // Player1 should win (rock > scissors)
    expect(partial.player1.roundsWon).toBe(1);
    expect(partial.player2.roundsWon).toBe(0);
    expect(partial.game.roundOutcome).toBeTruthy();
    expect(mockCallLLM).toHaveBeenCalledTimes(1);

    // callLLM prompt should mention both weapons and winner
    const prompt = mockCallLLM.mock.calls[0][0];
    expect(prompt).toContain('Banana Launcher');
    expect(prompt).toContain('Pillow Cannon');
    expect(prompt).toContain('player1');

    console.log('✓ resolve_round_outcome (p1 wins) passed');
  });

  it('resolve_round_outcome: handles tie correctly', async () => {
    const state = makeAliasedState();
    state.game.weaponMappings = {
      'Banana Launcher': 'rock',
      'Glitter Bomb': 'rock',
    };
    state.player1.selectedWeapon = 'Banana Launcher'; // rock
    state.player2.selectedWeapon = 'Glitter Bomb';    // rock
    state.player1.roundsWon = 1;
    state.player2.roundsWon = 0;

    const mockCallLLM = jest.fn<(prompt: string) => Promise<string>>()
      .mockResolvedValue('Banana Launcher and Glitter Bomb collide in a bewildering stalemate!');

    const partial = await executeMechanic(RESOLVE_ROUND_OUTCOME_BODY, state, mockCallLLM);

    console.log('resolve_round_outcome (tie):', JSON.stringify(partial, null, 2));

    // Tie: no score change
    expect(partial.player1.roundsWon).toBe(1);
    expect(partial.player2.roundsWon).toBe(0);
    expect(partial.game.roundOutcome).toBeTruthy();

    // callLLM prompt should indicate tie
    const prompt = mockCallLLM.mock.calls[0][0];
    expect(prompt).toContain('tie');

    console.log('✓ resolve_round_outcome (tie) passed');
  });

  it('state is read-only inside the sandbox', async () => {
    const mutatingBody = `
      state.game.currentPhase = "hacked";
      return {};
    `;
    const state = makeAliasedState();
    const mockCallLLM = jest.fn<(prompt: string) => Promise<string>>();

    await expect(
      executeMechanic(mutatingBody, state, mockCallLLM)
    ).rejects.toThrow();

    // Original state should be unchanged
    expect(state.game.currentPhase).toBe('weapon_setup');
    console.log('✓ State mutation rejected');
  });

  it('rejects non-object return values', async () => {
    const badReturnBody = `return "not an object";`;
    const state = makeAliasedState();
    const mockCallLLM = jest.fn<(prompt: string) => Promise<string>>();

    await expect(
      executeMechanic(badReturnBody, state, mockCallLLM)
    ).rejects.toThrow(/partial state object/);

    console.log('✓ Non-object return rejected');
  });
});

describe('deepMergeState', () => {

  it('merges nested objects recursively', () => {
    const target = {
      game: { currentPhase: 'old', currentRound: 1, weaponMappings: {} },
      players: { uuid1: { roundsWon: 0, ready: true } },
    };
    const partial = {
      game: { weaponMappings: { sword: 'rock' }, currentRound: 2 },
      players: { uuid1: { roundsWon: 1 } },
    };

    const result = deepMergeState(target, partial);

    expect(result.game.currentPhase).toBe('old'); // untouched
    expect(result.game.currentRound).toBe(2); // overridden
    expect(result.game.weaponMappings).toEqual({ sword: 'rock' }); // replaced (was empty)
    expect(result.players.uuid1.roundsWon).toBe(1);
    expect(result.players.uuid1.ready).toBe(true); // preserved
  });

  it('replaces arrays instead of concatenating', () => {
    const target = { game: { publicMessages: ['old msg'] } };
    const partial = { game: { publicMessages: ['new msg'] } };

    const result = deepMergeState(target, partial);
    expect(result.game.publicMessages).toEqual(['new msg']);
  });

  it('does not mutate target', () => {
    const target = { game: { val: 1 } };
    const partial = { game: { val: 2 } };
    const result = deepMergeState(target, partial);
    expect(target.game.val).toBe(1);
    expect(result.game.val).toBe(2);
  });
});
