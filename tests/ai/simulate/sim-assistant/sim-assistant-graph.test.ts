/**
 * Sim Assistant Graph — Integration Test
 *
 * Tests the full diagnostic flow: user message → ReAct agent → tool calls → response.
 * Uses real LLM with MemorySaver-backed checkpointers and pre-seeded runtime state.
 */
import { MemorySaver } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import crypto from 'node:crypto';

import { createSimAssistantGraph } from '#chaincraft/ai/simulate/graphs/sim-assistant-graph/index.js';
import { buildManifest } from '#chaincraft/ai/simulate/graphs/sim-assistant-graph/prompts.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION_ID = 'test-sim-assistant-rps';
const GAME_ID = 'rock-paper-scissors-test';

const RPS_GAME_RULES = `# Rock Paper Scissors
2-player game. Each player picks Rock, Paper, or Scissors simultaneously.
Rock beats Scissors, Scissors beats Paper, Paper beats Rock.
Best of 3 rounds. Player with 2 wins first wins the game.`;

const RPS_STATE_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    round: { type: 'number', description: 'Current round number (1-3)' },
    scores: { type: 'object', properties: { player1: { type: 'number' }, player2: { type: 'number' } } },
    choices: { type: 'object', properties: { player1: { type: 'string' }, player2: { type: 'string' } } },
    roundResult: { type: 'string', description: 'Result of the current round' },
  },
}, null, 2);

const RPS_STATE_TRANSITIONS = JSON.stringify({
  phases: [
    { name: 'submit_choices', requiresPlayerInput: true },
    { name: 'resolve_round', requiresPlayerInput: false },
    { name: 'check_winner', requiresPlayerInput: false },
    { name: 'finished', requiresPlayerInput: false },
  ],
  transitions: [
    { id: 'submit_to_resolve', from: 'submit_choices', to: 'resolve_round', precondition: 'Both players have submitted choices' },
    { id: 'resolve_to_check', from: 'resolve_round', to: 'check_winner', precondition: 'Round result determined' },
    { id: 'check_to_submit', from: 'check_winner', to: 'submit_choices', precondition: 'No player has 2 wins yet' },
    { id: 'check_to_finished', from: 'check_winner', to: 'finished', precondition: 'A player has 2 wins' },
  ],
}, null, 2);

const RPS_TRANSITION_INSTRUCTIONS: Record<string, string> = {
  submit_to_resolve: 'Collect both player choices. If fewer than 2 received, wait.',
  resolve_to_check: 'Compare choices: Rock > Scissors > Paper > Rock. Update scores.',
  check_to_submit: 'If max(scores) < 2, go back to submit_choices and increment round.',
  check_to_finished: 'If max(scores) >= 2, set isGameWinner for the leading player.',
};

const RPS_GAME_STATE = JSON.stringify({
  round: 2,
  scores: { player1: 1, player2: 1 },
  choices: { player1: 'rock', player2: 'paper' },
  roundResult: 'Player 2 wins round 2',
});

// ─── Checkpoint Seeding ───────────────────────────────────────────────────────

async function seedRuntimeCheckpoint(saver: MemorySaver): Promise<void> {
  const config = { configurable: { thread_id: SESSION_ID } };
  const checkpoint = {
    v: 1,
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    channel_values: {
      gameId: GAME_ID,
      gameSpecificationVersion: 1,
      players: ['player1', 'player2'],
      gameRules: RPS_GAME_RULES,
      stateSchema: RPS_STATE_SCHEMA,
      stateTransitions: RPS_STATE_TRANSITIONS,
      transitionInstructions: RPS_TRANSITION_INSTRUCTIONS,
      playerPhaseInstructions: {},
      generatedMechanics: {},
      gameState: RPS_GAME_STATE,
      currentPhase: 'resolve_round',
      isInitialized: true,
      winningPlayers: [],
      playerAction: { playerId: 'player2', playerAction: 'paper' },
    },
    channel_versions: { __start__: 1 },
    versions_seen: { __start__: { __start__: 1 } },
    pending_sends: [],
  };

  await saver.put(config, checkpoint as any, { source: 'update', step: -1, writes: null }, {});
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Sim Assistant Graph', () => {
  let runtimeSaver: MemorySaver;
  let assistantSaver: MemorySaver;
  let graph: Awaited<ReturnType<typeof createSimAssistantGraph>>['graph'];
  let toolkit: Awaited<ReturnType<typeof createSimAssistantGraph>>['toolkit'];

  beforeAll(async () => {
    runtimeSaver = new MemorySaver();
    assistantSaver = new MemorySaver();

    await seedRuntimeCheckpoint(runtimeSaver);

    const result = await createSimAssistantGraph(assistantSaver, runtimeSaver, SESSION_ID);
    graph = result.graph;
    toolkit = result.toolkit;
  }, 30_000);

  it('buildManifest should summarize runtime state', async () => {
    const manifest = await buildManifest(runtimeSaver, SESSION_ID);

    expect(manifest).toContain(GAME_ID);
    expect(manifest).toContain('2 players');
    expect(manifest).toContain('running');
    expect(manifest).toContain('resolve_round');
  });

  it('should diagnose game state when asked a question', async () => {
    const manifest = await buildManifest(runtimeSaver, SESSION_ID);
    const config = { configurable: { thread_id: SESSION_ID } };

    const result = await graph.invoke(
      {
        messages: [new HumanMessage('The game is tied 1-1 in round 2. What happens next?')],
        sessionId: SESSION_ID,
        gameId: GAME_ID,
        manifest,
      },
      config,
    );

    // Should have AI response message(s)
    const messages = result.messages;
    expect(messages.length).toBeGreaterThan(1); // At least user + AI

    // Last message should be from the AI
    const lastMessage = messages[messages.length - 1];
    expect(lastMessage._getType()).toBe('ai');

    // The AI's response should reference game concepts
    const content = typeof lastMessage.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);
    expect(content.length).toBeGreaterThan(0);

    console.log('[sim-assistant-test] AI response:', content.slice(0, 500));
  }, 120_000);

  it('should use tools to retrieve artifacts when asked about schema', async () => {
    const manifest = await buildManifest(runtimeSaver, SESSION_ID);
    const config = { configurable: { thread_id: `${SESSION_ID}-schema` } };

    const result = await graph.invoke(
      {
        messages: [new HumanMessage('Show me the game state schema. What fields does it have?')],
        sessionId: SESSION_ID,
        gameId: GAME_ID,
        manifest,
      },
      config,
    );

    const messages = result.messages;
    const lastMessage = messages[messages.length - 1];
    const content = typeof lastMessage.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);

    // Should mention schema fields from our fixture
    const mentionsSchemaFields =
      content.includes('round') ||
      content.includes('scores') ||
      content.includes('choices') ||
      content.includes('roundResult');
    expect(mentionsSchemaFields).toBe(true);

    // Should have tool messages in conversation (indicating tool was called)
    const toolMessages = messages.filter((m: any) => m._getType() === 'tool');
    expect(toolMessages.length).toBeGreaterThan(0);

    console.log('[sim-assistant-test] Schema query - tools used:', toolMessages.length);
    console.log('[sim-assistant-test] AI response:', content.slice(0, 500));
  }, 120_000);

  it('toolkit.invalidate should cause tools to reload artifacts', async () => {
    // Call invalidate
    toolkit.invalidate();

    // The next tool invocation would reload from checkpoint.
    // We verify invalidate doesn't throw and the toolkit is still functional.
    expect(toolkit.tools.length).toBe(4);
    expect(typeof toolkit.invalidate).toBe('function');
  });
});
