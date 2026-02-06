/**
 * Game Test Harness Types
 */

export interface GameTest {
  name: string;
  spec: string;
  scenarios: Scenario[];
  
  /**
   * Optional path to pre-generated artifacts JSON file.
   * If provided, artifacts will be loaded from this file instead of generating from spec.
   * Path is relative to the test file location.
   * 
   * Use this for:
   * - Debugging specific artifact sets that cause issues
   * - Regression tests to lock in known problematic artifacts
   * - Faster test iteration by skipping artifact generation
   */
  artifactsFile?: string;
  
  /**
   * Optional path to narratives JSON file.
   * If provided, narratives will be loaded from this file and passed to spec processing.
   * Path is relative to the test file location.
   * 
   * Use this for:
   * - Injecting pre-generated narratives into the spec processing
   * - Testing specific narrative guidance for consistent scenario generation
   * - Validating that narratives are properly used by the instruction planner
   */
  narrativesFile?: string;
}

export interface Scenario {
  name: string;
  description: string;
  playerActions: PlayerAction[];
  expectedOutcome: ExpectedOutcome;
  assertions: Assertion[];
}

export interface PlayerAction {
  playerId: string | null;  // null for automatic phases
  actionType: string;
  actionData: any;
  expectedPhase?: string;   // Optional validation
}

export interface ExpectedOutcome {
  gameEnded: boolean;
  winner?: string | null;  // Deprecated: use winningPlayers instead
  winningPlayers?: string[];  // Array of winning player IDs (empty array = draw/no winner)
  finalPhase?: string;
}

export type Assertion = (state: { game: any; players: any }) => AssertionResult;

export interface AssertionResult {
  passed: boolean;
  message: string;
}

export interface TestResult {
  testName: string;
  scenarioName: string;
  passed: boolean;
  duration: number;
  
  // Artifact generation
  artifactsGenerated: boolean;
  artifactErrors?: string[];
  
  // Simulation execution  
  simulationCompleted: boolean;
  simulationError?: string;
  turns: number;
  
  // Assertion results
  assertionResults: AssertionResult[];
  
  // Final state (for debugging)
  finalState?: any;
}

export interface ReliabilityReport {
  testName: string;
  iterations: number;
  successCount: number;
  successRate: number;
  averageDuration: number;
  
  failures: FailureSummary[];
}

export interface FailureSummary {
  phase: FailurePhase;
  errorType: string;
  occurrences: number;
  exampleErrors: string[];
}

export enum FailurePhase {
  SCHEMA_GENERATION = "schema-generation",
  SCHEMA_VALIDATION = "schema-validation",
  TRANSITIONS_GENERATION = "transitions-generation",
  TRANSITIONS_VALIDATION = "transitions-validation",
  INSTRUCTIONS_GENERATION = "instructions-generation",
  SIMULATION_SETUP = "simulation-setup",
  SIMULATION_EXECUTION = "simulation-execution",
  SIMULATION_STUCK = "simulation-stuck",
  ASSERTION_FAILED = "assertion-failed",
}
