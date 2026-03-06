/**
 * Provider Comparison Test: Claude vs Minimax — CT Arena
 *
 * Runs the FULL spec processing pipeline (schema → transitions → validate →
 * repair → instructions → repair → produced-tokens) on the CT Arena game spec
 * with two providers:
 *
 *   1. Claude (Haiku + Sonnet) — current production configuration
 *   2. Minimax M2.5 via Anthropic-compatible endpoint — all M2.5
 *
 * Compares: artifact quality, structural correctness, pipeline completion,
 * wall clock time, and artifact sizes. Saves all artifacts to
 * test-results/provider-comparison/{claude,minimax}/ for manual diffing.
 *
 * ⚠️  Makes REAL LLM calls to both providers.
 *     Requires: ANTHROPIC_API_KEY_CREATE + MINIMAX_API_KEY in .env
 *     Cost estimate: ~$0.10–0.30 per provider run.
 *
 * Run:  npx jest tests/ai/simulate/spec-processing/provider-comparison.test.ts --no-cache
 */

import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Fixture imports — no env dependency
import {
  CT_ARENA_SPEC,
  CT_ARENA_NARRATIVES,
} from './fixtures/ct-arena.js';

// ── Constants ──

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '../../../../test-results/provider-comparison');

/**
 * Env vars we manipulate between provider runs.
 * Saved/restored so the test is hermetic.
 */
const ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY_CREATE',
  'CHAINCRAFT_SIM_SCHEMA_EXTRACTION_MODEL',
  'CHAINCRAFT_SPEC_TRANSITIONS_MODEL',
  'CHAINCRAFT_SIM_INSTRUCTIONS_MODEL',
  'CHAINCRAFT_ARTIFACT_EDITOR_COORDINATOR_MODEL',
  'CHAINCRAFT_ARTIFACT_EDITOR_MODEL',
  'CHAINCRAFT_SIMULATION_MODEL_NAME',
  'CHAINCRAFT_ARTIFACT_CREATION_TRACER_PROJECT_NAME',
] as const;

// ── Types ──

interface QualityMetrics {
  schemaFieldCount: number;
  gameFieldCount: number;
  playerFieldCount: number;
  transitionCount: number;
  phaseInstructionCount: number;
  transitionInstructionCount: number;
  hasHpField: boolean;
  hasPersonaField: boolean;
  hasInitPhase: boolean;
  hasFinishedPhase: boolean;
  publicMessageInPreconditions: boolean;
  pipelineCompletedFully: boolean;
}

interface ProviderResult {
  provider: string;
  elapsed: number;
  quality: QualityMetrics;
  validationErrors: {
    schema: string[] | null | undefined;
    transitions: string[] | null | undefined;
    instructions: string[] | null | undefined;
    producedTokens: string[] | null | undefined;
  };
  artifactSizes: {
    schema: number;
    transitions: number;
    playerPhaseInstructions: number;
    transitionInstructions: number;
    producedTokens: number;
  };
}

// ── Helpers ──

function extractQualityMetrics(result: any): QualityMetrics {
  let schemaFieldCount = 0,
    gameFieldCount = 0,
    playerFieldCount = 0;
  let transitionCount = 0;
  let hasHpField = false,
    hasPersonaField = false;
  let hasInitPhase = false,
    hasFinishedPhase = false;
  let publicMessageInPreconditions = false;

  try {
    const fields = JSON.parse(result.stateSchema || '[]');
    schemaFieldCount = fields.length;
    gameFieldCount = fields.filter((f: any) => f.path === 'game').length;
    playerFieldCount = fields.filter((f: any) => f.path === 'player').length;
    const fieldNames = fields.map((f: any) => (f.name || '').toLowerCase());
    hasHpField = fieldNames.some((n: string) => n.includes('hp'));
    hasPersonaField = fieldNames.some((n: string) => n.includes('persona'));
  } catch {
    /* schema not parseable — counts stay 0 */
  }

  try {
    const parsed = JSON.parse(result.stateTransitions || '{}');
    const transitions = parsed.transitions || [];
    transitionCount = transitions.length;
    const phases = new Set<string>();
    for (const t of transitions) {
      if (t.from) phases.add(t.from.toLowerCase());
      if (t.to) phases.add(t.to.toLowerCase());
      if (t.preconditions) {
        for (const p of t.preconditions) {
          if (JSON.stringify(p.logic || {}).includes('publicMessage')) {
            publicMessageInPreconditions = true;
          }
        }
      }
    }
    hasInitPhase = [...phases].some((p) => p.includes('init')) ||
      transitions.some((t: any) => t.id?.toLowerCase().includes('init'));
    hasFinishedPhase = [...phases].some((p) => p === 'finished');
  } catch {
    /* transitions not parseable */
  }

  const phaseInstructionCount = Object.keys(
    result.playerPhaseInstructions || {},
  ).length;
  const transitionInstructionCount = Object.keys(
    result.transitionInstructions || {},
  ).length;

  const pipelineCompletedFully =
    schemaFieldCount > 0 &&
    transitionCount > 0 &&
    phaseInstructionCount > 0 &&
    transitionInstructionCount > 0 &&
    (result.producedTokensConfiguration || '').length > 0;

  return {
    schemaFieldCount,
    gameFieldCount,
    playerFieldCount,
    transitionCount,
    phaseInstructionCount,
    transitionInstructionCount,
    hasHpField,
    hasPersonaField,
    hasInitPhase,
    hasFinishedPhase,
    publicMessageInPreconditions,
    pipelineCompletedFully,
  };
}

function saveArtifacts(result: any, providerDir: string) {
  fs.mkdirSync(providerDir, { recursive: true });
  fs.writeFileSync(
    path.join(providerDir, 'schema.json'),
    result.stateSchema || '',
  );
  fs.writeFileSync(
    path.join(providerDir, 'transitions.json'),
    result.stateTransitions || '',
  );
  fs.writeFileSync(
    path.join(providerDir, 'playerPhaseInstructions.json'),
    JSON.stringify(result.playerPhaseInstructions || {}, null, 2),
  );
  fs.writeFileSync(
    path.join(providerDir, 'transitionInstructions.json'),
    JSON.stringify(result.transitionInstructions || {}, null, 2),
  );
  fs.writeFileSync(
    path.join(providerDir, 'producedTokens.json'),
    result.producedTokensConfiguration || '',
  );
}

function fmt(n: number, decimals: number): string {
  return n.toFixed(decimals);
}

function delta(a: number, b: number): string {
  const d = b - a;
  return d === 0 ? '=' : d > 0 ? `+${d}` : `${d}`;
}

function yn(b: boolean): string {
  return b ? '✓' : '✗';
}

// ── Test Suite ──

describe('Provider Comparison: Claude vs Minimax — CT Arena', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const results: Record<string, ProviderResult> = {};

  // ── Env Management ──

  function saveEnv() {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
  }

  function restoreEnv() {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  }

  function setEnv(overrides: Record<string, string | undefined>) {
    for (const [key, val] of Object.entries(overrides)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  }

  // ── Pipeline Runner ──

  async function runPipeline(providerLabel: string): Promise<ProviderResult> {
    // Reset module cache so model-config.ts re-reads env vars at init
    jest.resetModules();

    // Dynamic imports after reset — every module re-evaluates
    const { createSpecProcessingGraph } = await import(
      '#chaincraft/ai/simulate/graphs/spec-processing-graph/index.js'
    );
    const { InMemoryStore } = await import('@langchain/langgraph');

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  PROVIDER RUN: ${providerLabel.toUpperCase()}`);
    console.log(`${'='.repeat(60)}\n`);

    const startTime = Date.now();
    const graph = await createSpecProcessingGraph();
    const result = await graph.invoke(
      {
        gameSpecification: CT_ARENA_SPEC,
        specNarratives: CT_ARENA_NARRATIVES,
      },
      {
        store: new InMemoryStore(),
        configurable: {
          thread_id: `comparison-${providerLabel}-${Date.now()}`,
        },
      },
    );
    const elapsed = Date.now() - startTime;

    // Extract metrics
    const quality = extractQualityMetrics(result);

    // Save artifacts to disk
    const providerDir = path.join(OUTPUT_DIR, providerLabel);
    saveArtifacts(result, providerDir);

    // Also save a summary JSON
    const ppiStr = JSON.stringify(result.playerPhaseInstructions || {});
    const tiStr = JSON.stringify(result.transitionInstructions || {});

    const providerResult: ProviderResult = {
      provider: providerLabel,
      elapsed,
      quality,
      validationErrors: {
        schema: result.schemaValidationErrors,
        transitions: result.transitionsValidationErrors,
        instructions: result.instructionsValidationErrors,
        producedTokens: result.producedTokensValidationErrors,
      },
      artifactSizes: {
        schema: (result.stateSchema || '').length,
        transitions: (result.stateTransitions || '').length,
        playerPhaseInstructions: ppiStr.length,
        transitionInstructions: tiStr.length,
        producedTokens: (result.producedTokensConfiguration || '').length,
      },
    };

    fs.writeFileSync(
      path.join(providerDir, 'summary.json'),
      JSON.stringify(providerResult, null, 2),
    );

    // Console summary for this run
    console.log(`\n  ${providerLabel.toUpperCase()} completed in ${(elapsed / 1000).toFixed(1)}s`);
    console.log(`  Schema: ${quality.schemaFieldCount} fields (${quality.gameFieldCount} game, ${quality.playerFieldCount} player)`);
    console.log(`  Transitions: ${quality.transitionCount}`);
    console.log(`  Phase instructions: ${quality.phaseInstructionCount}`);
    console.log(`  Transition instructions: ${quality.transitionInstructionCount}`);
    console.log(`  Pipeline complete: ${quality.pipelineCompletedFully}`);
    console.log(`  Validation errors: schema=${result.schemaValidationErrors?.length ?? 0} transitions=${result.transitionsValidationErrors?.length ?? 0} instructions=${result.instructionsValidationErrors?.length ?? 0}`);

    return providerResult;
  }

  // ── Setup / Teardown ──

  beforeAll(() => {
    saveEnv();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  });

  afterAll(() => {
    restoreEnv();
  });

  // ── Tests ──

  it('Claude baseline (Haiku + Sonnet)', async () => {
    // Ensure no base URL override — use Anthropic directly
    delete process.env.ANTHROPIC_BASE_URL;
    // Model names come from .env defaults:
    //   Schema + produced-tokens → Haiku
    //   Transitions + Instructions → Sonnet

    results.claude = await runPipeline('claude');

    // Quality assertions (same bar as the regression test)
    expect(results.claude.quality.pipelineCompletedFully).toBe(true);
    expect(results.claude.quality.schemaFieldCount).toBeGreaterThanOrEqual(10);
    expect(results.claude.quality.transitionCount).toBeGreaterThanOrEqual(5);
    expect(results.claude.quality.hasHpField).toBe(true);
    expect(results.claude.quality.hasPersonaField).toBe(true);
    expect(results.claude.quality.hasInitPhase).toBe(true);
    expect(results.claude.quality.hasFinishedPhase).toBe(true);
    expect(results.claude.quality.publicMessageInPreconditions).toBe(false);
  }, 600_000);

  it('Minimax M2.5 comparison', async () => {
    // Pre-flight: ensure Minimax key is available
    const minimaxKey = process.env.MINIMAX_API_KEY;
    if (!minimaxKey) {
      console.warn('⚠️  MINIMAX_API_KEY not set — skipping Minimax run');
      return;
    }

    // Override env for Minimax: all models → MiniMax-M2.5, route via Minimax endpoint
    setEnv({
      ANTHROPIC_BASE_URL: 'https://api.minimax.io/anthropic',
      ANTHROPIC_API_KEY_CREATE: minimaxKey,
      CHAINCRAFT_SIM_SCHEMA_EXTRACTION_MODEL: 'MiniMax-M2.5',
      CHAINCRAFT_SPEC_TRANSITIONS_MODEL: 'MiniMax-M2.5',
      CHAINCRAFT_SIM_INSTRUCTIONS_MODEL: 'MiniMax-M2.5',
      CHAINCRAFT_ARTIFACT_EDITOR_COORDINATOR_MODEL: 'MiniMax-M2.5',
      CHAINCRAFT_ARTIFACT_EDITOR_MODEL: 'MiniMax-M2.5',
      CHAINCRAFT_SIMULATION_MODEL_NAME: 'MiniMax-M2.5',
      CHAINCRAFT_ARTIFACT_CREATION_TRACER_PROJECT_NAME:
        'chaincraft-minimax-comparison',
    });

    results.minimax = await runPipeline('minimax');

    // Same quality bar — Minimax should meet minimum structural requirements
    expect(results.minimax.quality.pipelineCompletedFully).toBe(true);
    expect(results.minimax.quality.schemaFieldCount).toBeGreaterThanOrEqual(10);
    expect(results.minimax.quality.transitionCount).toBeGreaterThanOrEqual(5);
    expect(results.minimax.quality.hasHpField).toBe(true);
    expect(results.minimax.quality.hasPersonaField).toBe(true);
    expect(results.minimax.quality.hasInitPhase).toBe(true);
    expect(results.minimax.quality.hasFinishedPhase).toBe(true);
    expect(results.minimax.quality.publicMessageInPreconditions).toBe(false);
  }, 600_000);

  it('prints comparison summary', () => {
    if (!results.claude || !results.minimax) {
      console.warn(
        'Skipping comparison — both providers must complete successfully',
      );
      return;
    }

    const c = results.claude;
    const m = results.minimax;

    console.log('\n' + '═'.repeat(72));
    console.log('  PROVIDER COMPARISON SUMMARY: Claude vs Minimax (CT Arena)');
    console.log('═'.repeat(72));

    // ── Metrics Table ──
    const rows: (string | number | boolean)[][] = [
      ['Metric', 'Claude', 'Minimax', 'Delta'],
      ['─'.repeat(32), '─'.repeat(12), '─'.repeat(12), '─'.repeat(12)],
      [
        'Wall clock (s)',
        fmt(c.elapsed / 1000, 1),
        fmt(m.elapsed / 1000, 1),
        `${(((m.elapsed - c.elapsed) / c.elapsed) * 100).toFixed(0)}%`,
      ],
      [
        'Schema fields',
        c.quality.schemaFieldCount,
        m.quality.schemaFieldCount,
        delta(c.quality.schemaFieldCount, m.quality.schemaFieldCount),
      ],
      [
        '  game fields',
        c.quality.gameFieldCount,
        m.quality.gameFieldCount,
        delta(c.quality.gameFieldCount, m.quality.gameFieldCount),
      ],
      [
        '  player fields',
        c.quality.playerFieldCount,
        m.quality.playerFieldCount,
        delta(c.quality.playerFieldCount, m.quality.playerFieldCount),
      ],
      [
        'Transitions',
        c.quality.transitionCount,
        m.quality.transitionCount,
        delta(c.quality.transitionCount, m.quality.transitionCount),
      ],
      [
        'Phase instructions',
        c.quality.phaseInstructionCount,
        m.quality.phaseInstructionCount,
        delta(
          c.quality.phaseInstructionCount,
          m.quality.phaseInstructionCount,
        ),
      ],
      [
        'Transition instructions',
        c.quality.transitionInstructionCount,
        m.quality.transitionInstructionCount,
        delta(
          c.quality.transitionInstructionCount,
          m.quality.transitionInstructionCount,
        ),
      ],
      [
        'HP field',
        yn(c.quality.hasHpField),
        yn(m.quality.hasHpField),
        '',
      ],
      [
        'Persona field',
        yn(c.quality.hasPersonaField),
        yn(m.quality.hasPersonaField),
        '',
      ],
      [
        'init phase',
        yn(c.quality.hasInitPhase),
        yn(m.quality.hasInitPhase),
        '',
      ],
      [
        'finished phase',
        yn(c.quality.hasFinishedPhase),
        yn(m.quality.hasFinishedPhase),
        '',
      ],
      [
        'publicMessage in pre',
        yn(c.quality.publicMessageInPreconditions),
        yn(m.quality.publicMessageInPreconditions),
        '',
      ],
      [
        'Pipeline complete',
        yn(c.quality.pipelineCompletedFully),
        yn(m.quality.pipelineCompletedFully),
        '',
      ],
    ];

    for (const row of rows) {
      console.log(
        `  ${String(row[0]).padEnd(32)} ${String(row[1]).padStart(12)} ${String(row[2]).padStart(12)} ${String(row[3]).padStart(12)}`,
      );
    }

    // ── Artifact Sizes ──
    console.log('\n  Artifact Sizes (chars):');
    const sizeKeys = Object.keys(c.artifactSizes) as (keyof typeof c.artifactSizes)[];
    for (const key of sizeKeys) {
      const cv = c.artifactSizes[key];
      const mv = m.artifactSizes[key];
      const pct = cv > 0 ? `${(((mv - cv) / cv) * 100).toFixed(0)}%` : 'n/a';
      console.log(
        `    ${key.padEnd(28)} ${String(cv).padStart(8)} ${String(mv).padStart(8)} ${pct.padStart(8)}`,
      );
    }

    // ── Validation Errors ──
    console.log('\n  Validation Errors:');
    console.log(
      `    Claude:  schema=${c.validationErrors.schema?.length ?? 0}  transitions=${c.validationErrors.transitions?.length ?? 0}  instructions=${c.validationErrors.instructions?.length ?? 0}`,
    );
    console.log(
      `    Minimax: schema=${m.validationErrors.schema?.length ?? 0}  transitions=${m.validationErrors.transitions?.length ?? 0}  instructions=${m.validationErrors.instructions?.length ?? 0}`,
    );

    // ── Footer ──
    console.log(
      '\n  Artifacts saved to: test-results/provider-comparison/{claude,minimax}/',
    );
    console.log(
      '  Diff:  diff test-results/provider-comparison/claude/schema.json test-results/provider-comparison/minimax/schema.json',
    );
    console.log(
      '  LangSmith: chaincraft-dev-artifact-create-test (Claude) | chaincraft-minimax-comparison-test (Minimax)',
    );
    console.log('\n' + '═'.repeat(72) + '\n');

    // Save comparison JSON for programmatic use
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'comparison.json'),
      JSON.stringify(
        {
          claude: {
            elapsed: c.elapsed,
            quality: c.quality,
            artifactSizes: c.artifactSizes,
            validationErrors: c.validationErrors,
          },
          minimax: {
            elapsed: m.elapsed,
            quality: m.quality,
            artifactSizes: m.artifactSizes,
            validationErrors: m.validationErrors,
          },
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  });
});
