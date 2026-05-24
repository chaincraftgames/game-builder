/**
 * Target Builder — Unit Test
 *
 * Proves that buildMechanicTargets:
 * 1. Only uses mechanicsGuidance (not stateDelta) to build targets
 * 2. Produces identical targets regardless of stateDelta content
 * 3. Skips transitions without mechanicsGuidance
 */

import { describe, it, expect } from '@jest/globals';
import { buildMechanicTargets } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/target-builder.js';

// Instruction with both mechanicsGuidance AND stateDelta
const instructionWithBoth = {
  id: "resolve_round",
  transitionName: "Resolve Round",
  mechanicsGuidance: {
    rules: [
      "Compare player weapons using RPS rules",
      "Winner gets 1 point",
    ],
    computation: "Map weapons to RPS, compare, update scores",
  },
  stateDelta: [
    { op: "set", path: "game.roundNumber", value: "{{computed_round}}" },
    { op: "increment", path: "players.*.score", value: 1 },
  ],
  messages: {
    public: { template: "Round resolved! {{winner}} wins." },
    private: [{ recipient: "winner", template: "You won this round!" }],
  },
};

// Same instruction but WITHOUT stateDelta
const instructionWithoutStateDelta = {
  id: "resolve_round",
  transitionName: "Resolve Round",
  mechanicsGuidance: {
    rules: [
      "Compare player weapons using RPS rules",
      "Winner gets 1 point",
    ],
    computation: "Map weapons to RPS, compare, update scores",
  },
  messages: {
    public: { template: "Round resolved! {{winner}} wins." },
    private: [{ recipient: "winner", template: "You won this round!" }],
  },
};

// Instruction with ONLY stateDelta (no mechanicsGuidance)
const instructionStateDeltaOnly = {
  id: "initialize_game",
  transitionName: "Initialize Game",
  mechanicsGuidance: null,
  stateDelta: [
    { op: "set", path: "game.roundNumber", value: 1 },
    { op: "set", path: "game.currentPhase", value: "weapon_selection" },
  ],
  messages: {
    public: { template: "Game started!" },
  },
};

// Player phase instruction with mechanicsGuidance on an action
const playerPhaseWithMechanics = {
  phase: "weapon_selection",
  playerActions: [
    {
      id: "select_weapon",
      actionName: "Select Weapon",
      mechanicsGuidance: {
        rules: ["Validate weapon is in player's inventory"],
        computation: "Check inventory, mark weapon as selected",
      },
      stateDelta: [
        { op: "set", path: "players.{{playerId}}.selectedWeapon", value: "{{weapon}}" },
      ],
      messages: {
        private: [{ recipient: "{{playerId}}", template: "You selected {{weapon}}" }],
      },
    },
    {
      id: "pass_turn",
      actionName: "Pass Turn",
      mechanicsGuidance: null,
      stateDelta: [
        { op: "set", path: "players.{{playerId}}.passed", value: true },
      ],
    },
  ],
};

describe('buildMechanicTargets', () => {
  it('produces identical targets with and without stateDelta', () => {
    const withDelta = buildMechanicTargets(
      { resolve_round: JSON.stringify(instructionWithBoth) },
      {},
    );

    const withoutDelta = buildMechanicTargets(
      { resolve_round: JSON.stringify(instructionWithoutStateDelta) },
      {},
    );

    expect(withDelta).toEqual(withoutDelta);
    expect(withDelta).toHaveLength(1);
    expect(withDelta[0].id).toBe('resolve_round');
    console.log('✓ Identical targets regardless of stateDelta presence');
  });

  it('skips transitions without mechanicsGuidance', () => {
    const targets = buildMechanicTargets(
      {
        resolve_round: JSON.stringify(instructionWithBoth),
        initialize_game: JSON.stringify(instructionStateDeltaOnly),
      },
      {},
    );

    expect(targets).toHaveLength(1);
    expect(targets[0].id).toBe('resolve_round');
    console.log('✓ initialize_game (no mechanicsGuidance) correctly skipped');
  });

  it('includes player actions with mechanicsGuidance, skips those without', () => {
    const targets = buildMechanicTargets(
      {},
      { weapon_selection: JSON.stringify(playerPhaseWithMechanics) },
    );

    expect(targets).toHaveLength(1);
    expect(targets[0].id).toBe('select_weapon');
    expect(targets[0].type).toBe('action');
    console.log('✓ select_weapon included, pass_turn (no mechanicsGuidance) skipped');
  });

  it('formats mechanicsGuidance rules and computation as instructions', () => {
    const targets = buildMechanicTargets(
      { resolve_round: JSON.stringify(instructionWithBoth) },
      {},
    );

    const target = targets[0];
    expect(target.instructions).toContain('Compare player weapons using RPS rules');
    expect(target.instructions).toContain('Winner gets 1 point');
    expect(target.instructions).toContain('Computation: Map weapons to RPS, compare, update scores');
    console.log('✓ Instructions formatted from mechanicsGuidance object');
  });

  it('includes message guidance from instruction messages', () => {
    const targets = buildMechanicTargets(
      { resolve_round: JSON.stringify(instructionWithBoth) },
      {},
    );

    const target = targets[0];
    expect(target.messageGuidance).toBeDefined();
    expect(target.messageGuidance).toContain('Round resolved!');
    console.log('✓ Message guidance extracted from instruction messages');
  });

  it('handles string-form mechanicsGuidance', () => {
    const stringGuidance = {
      id: "simple_transition",
      transitionName: "Simple",
      mechanicsGuidance: "Just add 1 to the score",
      stateDelta: [],
    };

    const targets = buildMechanicTargets(
      { simple_transition: JSON.stringify(stringGuidance) },
      {},
    );

    expect(targets).toHaveLength(1);
    expect(targets[0].instructions).toBe("Just add 1 to the score");
    console.log('✓ String mechanicsGuidance passed through as-is');
  });
});
