/**
 * Coherence Check Node — Unit Test
 *
 * Runs runCoherenceCheck directly against known artifacts (Absurd Armaments, run 3).
 * Faster than the full e2e — no spec regeneration, no gameplay, no DB reset required.
 *
 * Makes a REAL LLM call. Requires CHAINCRAFT_SIM_API_KEY.
 *
 * Run:
 *   cd game-builder && node --experimental-vm-modules node_modules/jest/bin/jest.js \
 *     tests/ai/simulate/coherence-check/coherence-check.test.ts --testTimeout=60000
 */

import { describe, it, expect } from '@jest/globals';
import { runCoherenceCheck } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/coherence-check/index.js';

// ---------------------------------------------------------------------------
// Artifacts from Absurd Armaments run 3 (known coherence-check input)
// ---------------------------------------------------------------------------

const STATE_TRANSITIONS = JSON.stringify({
  phases: ['init','game_show_opening','weapon_creation','opponent_reveal','weapon_selection','round_resolution','finished'],
  phaseMetadata: [
    { phase: 'init', requiresPlayerInput: false },
    { phase: 'game_show_opening', requiresPlayerInput: false },
    { phase: 'weapon_creation', requiresPlayerInput: true },
    { phase: 'opponent_reveal', requiresPlayerInput: false },
    { phase: 'weapon_selection', requiresPlayerInput: true },
    { phase: 'round_resolution', requiresPlayerInput: false },
    { phase: 'finished', requiresPlayerInput: false },
  ],
  transitions: [
    {
      id: 'initialize_game', fromPhase: 'init', toPhase: 'game_show_opening',
      preconditions: [{ id: 'is_init_phase', logic: { '==': [{ var: 'game.currentPhase' }, 'init'] }, deterministic: true, explain: '' }],
    },
    {
      id: 'display_game_show_opening', fromPhase: 'game_show_opening', toPhase: 'weapon_creation',
      preconditions: [{ id: 'is_game_show_opening_phase', logic: { '==': [{ var: 'game.currentPhase' }, 'game_show_opening'] }, deterministic: true, explain: '' }],
    },
    {
      id: 'both_players_submitted_weapons', fromPhase: 'weapon_creation', toPhase: 'opponent_reveal',
      preconditions: [{ id: 'all_weapons_submitted', logic: { var: 'allPlayersCompletedActions' }, deterministic: true, explain: '' }],
    },
    {
      id: 'reveal_opponent_arsenals', fromPhase: 'opponent_reveal', toPhase: 'weapon_selection',
      preconditions: [{ id: 'is_opponent_reveal_phase', logic: { '==': [{ var: 'game.currentPhase' }, 'opponent_reveal'] }, deterministic: true, explain: '' }],
    },
    {
      id: 'both_players_selected_weapons', fromPhase: 'weapon_selection', toPhase: 'round_resolution',
      preconditions: [{ id: 'all_selections_submitted', logic: { var: 'allPlayersCompletedActions' }, deterministic: true, explain: '' }],
    },
    {
      id: 'resolve_round_continue', fromPhase: 'round_resolution', toPhase: 'weapon_selection',
      preconditions: [{ id: 'game_not_ended', logic: { '!': [{ var: 'game.gameEnded' }] }, deterministic: true, explain: '' }],
    },
    {
      id: 'resolve_round_end_match', fromPhase: 'round_resolution', toPhase: 'finished',
      preconditions: [{ id: 'game_ended', logic: { '==': [{ var: 'game.gameEnded' }, true] }, deterministic: true, explain: '' }],
    },
  ],
});

const PLAYER_PHASE_INSTRUCTIONS: Record<string, string> = {
  weapon_creation: JSON.stringify({
    phase: 'weapon_creation',
    playerActions: [{
      id: 'submit-weapons',
      actionName: 'Submit Weapons',
      validation: { checks: [] },
      stateDelta: [
        { op: 'set', path: 'players.{{playerId}}.currentAction.type', value: 'submit-weapons' },
        { op: 'set', path: 'players.{{playerId}}.currentAction', value: { type: 'submit-weapons', weaponDescription: '{{input.weaponDescription}}' } },
      ],
      messages: { private: [{ to: '{{playerId}}', template: 'Your weapon has been received.' }], public: null },
    }],
  }),
  weapon_selection: JSON.stringify({
    phase: 'weapon_selection',
    playerActions: [{
      id: 'select-weapon',
      actionName: 'Select Weapon',
      validation: { checks: [] },
      stateDelta: [
        { op: 'set', path: 'players.{{playerId}}.currentAction', value: { type: 'select-weapon', weaponIndex: '{{input.weaponIndex}}' } },
      ],
      messages: { private: [{ to: '{{playerId}}', template: 'Weapon selected!' }], public: null },
    }],
  }),
};

const TRANSITION_INSTRUCTIONS: Record<string, string> = {
  initialize_game: JSON.stringify({
    id: 'initialize_game', transitionName: 'Initialize Game',
    stateDelta: [
      { op: 'set', path: 'game.roundNumber', value: 0 },
      { op: 'set', path: 'game.maxRounds', value: 3 },
      { op: 'set', path: 'game.winsToWin', value: 2 },
      { op: 'set', path: 'game.weaponRpsMap', value: {} },
      { op: 'setForAllPlayers', field: 'score', value: 0 },
      { op: 'setForAllPlayers', field: 'weapons', value: [] },
      { op: 'setForAllPlayers', field: 'weaponCount', value: 0 },
      { op: 'setForAllPlayers', field: 'currentAction', value: null },
      { op: 'setForAllPlayers', field: 'actionRequired', value: true },
      { op: 'setForAllPlayers', field: 'illegalActionCount', value: 0 },
      { op: 'setForAllPlayers', field: 'isGameWinner', value: false },
    ],
    messages: null,
  }),
  display_game_show_opening: JSON.stringify({
    id: 'display_game_show_opening', transitionName: 'Display Game Show Opening',
    mechanicsGuidance: { rules: ['Generate a boisterous opening announcement. Set actionRequired true for all players.'], computation: '' },
    stateDelta: [], messages: null,
  }),
  both_players_submitted_weapons: JSON.stringify({
    id: 'both_players_submitted_weapons', transitionName: 'Both Players Submitted Weapons',
    mechanicsGuidance: { rules: ["Read each player's currentAction and persist submitted weapons into player state. Check for minimal descriptions."], computation: '' },
    stateDelta: [], messages: null,
  }),
  reveal_opponent_arsenals: JSON.stringify({
    id: 'reveal_opponent_arsenals', transitionName: 'Reveal Opponent Arsenals',
    mechanicsGuidance: { rules: ["For each player generate a private narrative revealing opponent weapons. Assign RPS values. Set actionRequired true."], computation: '' },
    stateDelta: [], messages: null,
  }),
  both_players_selected_weapons: JSON.stringify({
    id: 'both_players_selected_weapons', transitionName: 'Both Players Selected Weapons',
    mechanicsGuidance: { rules: ["Read each player's currentAction and store selected weapon for this round."], computation: '' },
    stateDelta: [], messages: null,
  }),
  resolve_round_continue: JSON.stringify({
    id: 'resolve_round_continue', transitionName: 'Resolve Round (Continue)',
    mechanicsGuidance: { rules: ["Read selections from game.currentRoundSelections, look up RPS values, determine winner. Publish narrative. Increment round. Set actionRequired true."], computation: '' },
    stateDelta: [], messages: null,
  }),
  resolve_round_end_match: JSON.stringify({
    id: 'resolve_round_end_match', transitionName: 'Resolve Round & End Match',
    mechanicsGuidance: { rules: ["Read selections, apply RPS, update scores. Set isGameWinner. Set gameEnded true. Publish celebration."], computation: '' },
    stateDelta: [], messages: null,
  }),
};

// Mechanics from run 3 — the ones that were actually checked
const GENERATED_MECHANICS: Record<string, string> = {
  display_game_show_opening: `export async function display_game_show_opening(state, callLLM, rollDice) {
  const playerAliases = Object.keys(state).filter(k => k.startsWith('player'));
  const announcement = await callLLM('Generate a boisterous opening...');
  setPublicMessage(announcement);
  for (const alias of playerAliases) {
    setPlayer(alias, 'actionRequired', true);
  }
  return buildResult();
}`,

  both_players_submitted_weapons: `export async function both_players_submitted_weapons(state, callLLM, rollDice) {
  const playerAliases = Object.keys(state).filter(k => k.startsWith('player'));
  for (const alias of playerAliases) {
    const action = getPlayer(alias, 'currentAction');
    if (!action) { setPlayer(alias, 'currentAction', null); continue; }
    const weaponDescription = action.weaponDescription;
    let weapons = [];
    try { const p = JSON.parse(weaponDescription); weapons = Array.isArray(p) ? p.map(String) : [String(p)]; } catch { weapons = [weaponDescription]; }
    const snarky = [];
    for (const w of weapons) {
      if (w.trim().split(/\\s+/).length <= 2) {
        snarky.push(await callLLM('Snarky comment about: ' + w));
      }
    }
    let msg = 'Weapons received: ' + weapons.join(' | ');
    if (snarky.length) msg += '\\n\\n' + snarky.join('\\n');
    setPrivateMessage(alias, msg);
    setPlayer(alias, 'currentAction', null);
  }
  setPublicMessage('Both players have submitted their weapons!');
  return buildResult();
}`,

  reveal_opponent_arsenals: `export async function reveal_opponent_arsenals(state, callLLM, rollDice) {
  const playerAliases = Object.keys(state).filter(k => k.startsWith('player'));
  const playerWeapons = {};
  for (const alias of playerAliases) playerWeapons[alias] = [];
  const publicMessages = getGame('publicMessages');
  for (const alias of playerAliases) {
    const action = getPlayer(alias, 'currentAction');
    if (action && action.type === 'createWeapon') { playerWeapons[alias].push(action.weaponDescription); setPlayer(alias, 'currentAction', null); }
  }
  const narrative = await callLLM('Reveal opponent weapons');
  for (const alias of playerAliases) {
    setPrivateMessage(alias, narrative);
    setPlayer(alias, 'actionRequired', true);
    setPlayer(alias, 'actionsAllowed', true);
  }
  setPublicMessage('The arsenals have been revealed!');
  return buildResult();
}`,

  both_players_selected_weapons: `export async function both_players_selected_weapons(state, callLLM, rollDice) {
  const playerAliases = Object.keys(state).filter(k => k.startsWith('player'));
  const currentRoundSelections = {};
  for (const alias of playerAliases) {
    const action = getPlayer(alias, 'currentAction');
    if (action && action.type === 'selectWeapon') currentRoundSelections[alias] = action.weaponIndex;
    setPlayer(alias, 'currentAction', null);
  }
  const existingMessages = getGame('publicMessages') ?? [];
  const filtered = existingMessages.filter(m => !m.startsWith('{"__roundSelections":'));
  filtered.push(JSON.stringify({ __roundSelections: currentRoundSelections }));
  setGame('publicMessages', filtered);
  setPublicMessage('Both players have selected their weapons. Resolving...');
  return buildResult();
}`,

  resolve_round_continue: `export async function resolve_round_continue(state, callLLM, rollDice) {
  const playerAliases = Object.keys(state).filter(k => k.startsWith('player'));
  const publicMessages = getGame('publicMessages');
  const narrative = await callLLM('Round outcome narrative');
  setPublicMessage(narrative);
  setGame('publicMessage', narrative);
  setGame('publicMessages', [...(publicMessages ?? []), JSON.stringify({ type: 'scores' })]);
  for (const alias of playerAliases) {
    setPlayer(alias, 'currentAction', null);
    setPlayer(alias, 'actionRequired', true);
  }
  return buildResult();
}`,

  resolve_round_end_match: `export async function resolve_round_end_match(state, callLLM, rollDice) {
  const playerAliases = Object.keys(state).filter(k => k.startsWith('player'));
  const weaponRpsMap = getGame('weaponRpsMap');
  const [alias1, alias2] = playerAliases;
  const selectedIndex1 = getPlayer(alias1, 'selectedWeaponIndex');
  const createdWeapons1 = getPlayer(alias1, 'createdWeapons');
  const selectedIndex2 = getPlayer(alias2, 'selectedWeaponIndex');
  const createdWeapons2 = getPlayer(alias2, 'createdWeapons');
  const matchScore1 = getPlayer(alias1, 'matchScore');
  const matchScore2 = getPlayer(alias2, 'matchScore');
  setPlayer(alias1, 'matchScore', (matchScore1 ?? 0) + 1);
  setPlayer(alias2, 'isGameWinner', false);
  const narrative = await callLLM('Final round narrative');
  setPublicMessage(narrative);
  return buildResult();
}`,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Coherence Check Node', () => {
  it('should not flag missing_player_notification for mechanics that call setPublicMessage/setPrivateMessage', async () => {
    const result = await runCoherenceCheck({
      stateTransitions: STATE_TRANSITIONS,
      playerPhaseInstructions: PLAYER_PHASE_INSTRUCTIONS,
      transitionInstructions: TRANSITION_INSTRUCTIONS,
      generatedMechanics: GENERATED_MECHANICS,
    } as any);

    const findings = result.coherenceFindings!;

    console.log('Findings:', JSON.stringify(findings, null, 2));

    const notificationIssues = findings.issues.filter(i => i.issueType === 'missing_player_notification');
    expect(notificationIssues).toHaveLength(0);
  });

  it('should detect real issues: wrong_read_source and missing_write in resolve_round_end_match', async () => {
    const result = await runCoherenceCheck({
      stateTransitions: STATE_TRANSITIONS,
      playerPhaseInstructions: PLAYER_PHASE_INSTRUCTIONS,
      transitionInstructions: TRANSITION_INSTRUCTIONS,
      generatedMechanics: GENERATED_MECHANICS,
    } as any);

    const findings = result.coherenceFindings!;

    const wrongReadIssues = findings.issues.filter(i => i.issueType === 'wrong_read_source');
    const missingWriteIssues = findings.issues.filter(i => i.issueType === 'missing_write');

    // resolve_round_end_match reads selectedWeaponIndex and createdWeapons — neither is ever set
    expect(wrongReadIssues.length + missingWriteIssues.length).toBeGreaterThan(0);

    // LLM-originated issues (not missing_player_notification) should use transition IDs, not phase names
    const llmIssueIds = findings.issues
      .filter(i => i.issueType !== 'missing_player_notification')
      .flatMap(i => i.affectedIds);
    expect(llmIssueIds).not.toContain('weapon_creation');
    expect(llmIssueIds).not.toContain('weapon_selection');
  });

  it('should not flag initialize_game as missing_player_notification', async () => {
    const result = await runCoherenceCheck({
      stateTransitions: STATE_TRANSITIONS,
      playerPhaseInstructions: PLAYER_PHASE_INSTRUCTIONS,
      transitionInstructions: TRANSITION_INSTRUCTIONS,
      generatedMechanics: GENERATED_MECHANICS,
    } as any);

    const findings = result.coherenceFindings!;
    const initNotification = findings.issues.find(
      i => i.issueType === 'missing_player_notification' && i.affectedIds.includes('initialize_game')
    );
    expect(initNotification).toBeUndefined();
  });
});
