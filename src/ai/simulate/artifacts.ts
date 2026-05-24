/**
 * Centralized artifact key definitions.
 *
 * Single source of truth for the set of game artifacts flowing through
 * spec-processing → runtime → repair → rollback → publish.
 *
 * All derived types (patch, snapshot) use TypeScript utility types on
 * SpecArtifacts — no redundant interface definitions.
 */

import type { DataSourceConfig } from "#chaincraft/ai/design/game-design-state.js";

// ─── Spec artifacts: the complete set ─────────────────────────────────────────

/** Complete set of spec-processing artifacts. */
export interface SpecArtifacts {
  gameRules: string;
  stateSchema: string;
  stateTransitions: string;
  playerPhaseInstructions: Record<string, string>;
  transitionInstructions: Record<string, string>;
  generatedMechanics: Record<string, string>;
  producedTokensConfiguration: string;
  specNarratives: Record<string, string>;
  dataSources: DataSourceConfig[];
}

export const SPEC_ARTIFACT_KEYS: readonly (keyof SpecArtifacts)[] = [
  'gameRules',
  'stateSchema',
  'stateTransitions',
  'playerPhaseInstructions',
  'transitionInstructions',
  'generatedMechanics',
  'producedTokensConfiguration',
  'specNarratives',
  'dataSources',
] as const;

/** Safe empty defaults for every spec artifact field. */
export const SPEC_ARTIFACT_DEFAULTS: SpecArtifacts = {
  gameRules: '',
  stateSchema: '',
  stateTransitions: '',
  playerPhaseInstructions: {},
  transitionInstructions: {},
  generatedMechanics: {},
  producedTokensConfiguration: '',
  specNarratives: {},
  dataSources: [],
};

// ─── Repairable subset (repair-bridge, rollback, snapshot) ────────────────────

/** Artifact keys the repair system can modify and the rollback tool can restore. */
export const REPAIRABLE_ARTIFACT_KEYS = [
  'stateSchema',
  'stateTransitions',
  'playerPhaseInstructions',
  'transitionInstructions',
  'generatedMechanics',
] as const satisfies readonly (keyof SpecArtifacts)[];

export type RepairableArtifactKey = typeof REPAIRABLE_ARTIFACT_KEYS[number];

/** Pre-repair snapshot: required values for the repairable subset. */
export type ArtifactSnapshot = Pick<SpecArtifacts, RepairableArtifactKey>;

/** Partial patch for repairable artifacts. */
export type ArtifactPatch = Partial<ArtifactSnapshot>;

/** Read-only cache of artifacts used by the sim assistant tools and repair bridge. */
export type SimArtifactCache = Pick<SpecArtifacts, 'gameRules' | RepairableArtifactKey>;

// ─── Runtime-only fields preserved across restarts ────────────────────────────

/**
 * Fields preserved across a restart (artifacts + repair tracking + metadata).
 * Used by restart-tool to know what to keep when clearing the checkpoint.
 */
export const RESTART_PRESERVED_KEYS = [
  'gameId',
  'gameSpecificationVersion',
  ...SPEC_ARTIFACT_KEYS,
  'repairHistory',
  'artifactSnapshot',
] as const;

export type RestartPreservedKey = typeof RESTART_PRESERVED_KEYS[number];
