/**
 * Reliability Test Runner
 * 
 * Runs game tests multiple times to measure reliability.
 */

import type { GameTest, Scenario, TestResult, ReliabilityReport, FailurePhase } from "./types.js";
import { executeGameTest } from "./executor.js";

/**
 * Run reliability test for a single scenario
 */
export async function runReliabilityTest(
  test: GameTest,
  scenario: Scenario,
  iterations: number
): Promise<ReliabilityReport> {
  console.log(`\n=== Running Reliability Test ===`);
  console.log(`Game: ${test.name}`);
  console.log(`Scenario: ${scenario.name}`);
  console.log(`Iterations: ${iterations}\n`);
  
  const results: TestResult[] = [];
  
  for (let i = 0; i < iterations; i++) {
    console.log(`[${i + 1}/${iterations}] Running iteration...`);
    const result = await executeGameTest(test, scenario);
    results.push(result);
    
    if (result.passed) {
      console.log(`  ✓ PASSED (${result.duration}ms)`);
    } else {
      console.log(`  ✗ FAILED: ${result.simulationError || 'Assertions failed'}`);
    }
  }
  
  // Generate report
  const report = generateReport(test.name, results);
  printReport(report);
  
  return report;
}

/**
 * Run reliability test for all scenarios in a game
 */
export async function runFullReliabilityTest(
  test: GameTest,
  iterations: number
): Promise<ReliabilityReport[]> {
  const reports: ReliabilityReport[] = [];
  
  for (const scenario of test.scenarios) {
    const report = await runReliabilityTest(test, scenario, iterations);
    reports.push(report);
  }
  
  return reports;
}

/**
 * Generate reliability report from test results
 */
function generateReport(testName: string, results: TestResult[]): ReliabilityReport {
  const successCount = results.filter(r => r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  
  // Categorize failures
  const failures = categorizeFailures(results.filter(r => !r.passed));
  
  return {
    testName,
    iterations: results.length,
    successCount,
    successRate: successCount / results.length,
    averageDuration: totalDuration / results.length,
    failures,
  };
}

/**
 * Categorize failures by phase and type
 */
function categorizeFailures(failedResults: TestResult[]) {
  const failureMap = new Map<string, {
    phase: FailurePhase;
    errorType: string;
    occurrences: number;
    exampleErrors: string[];
  }>();
  
  for (const result of failedResults) {
    const phase = determineFailurePhase(result);
    const errorType = extractErrorType(result);
    const key = `${phase}:${errorType}`;
    
    if (!failureMap.has(key)) {
      failureMap.set(key, {
        phase,
        errorType,
        occurrences: 0,
        exampleErrors: [],
      });
    }
    
    const entry = failureMap.get(key)!;
    entry.occurrences++;
    
    // Keep up to 3 example errors
    if (entry.exampleErrors.length < 3) {
      const errorMsg = result.simulationError || 
                      result.artifactErrors?.join("; ") ||
                      result.assertionResults.find(a => !a.passed)?.message ||
                      "Unknown error";
      entry.exampleErrors.push(errorMsg);
    }
  }
  
  return Array.from(failureMap.values());
}

function determineFailurePhase(result: TestResult): FailurePhase {
  if (!result.artifactsGenerated) {
    return FailurePhase.SCHEMA_GENERATION; // or other artifact phase
  }
  if (result.artifactErrors && result.artifactErrors.length > 0) {
    return FailurePhase.SCHEMA_VALIDATION;
  }
  if (!result.simulationCompleted) {
    if (result.simulationError?.includes("stuck")) {
      return FailurePhase.SIMULATION_STUCK;
    }
    return FailurePhase.SIMULATION_EXECUTION;
  }
  if (result.assertionResults.some(a => !a.passed)) {
    return FailurePhase.ASSERTION_FAILED;
  }
  return FailurePhase.SIMULATION_EXECUTION;
}

function extractErrorType(result: TestResult): string {
  const error = result.simulationError || 
               result.artifactErrors?.[0] ||
               result.assertionResults.find(a => !a.passed)?.message;
  
  if (!error) return "unknown";
  
  // Extract key error patterns
  if (error.includes("not in schema")) return "missing_field";
  if (error.includes("stuck")) return "stuck_state";
  if (error.includes("ended prematurely")) return "premature_end";
  if (error.includes("assertion")) return "assertion_failed";
  
  return "other";
}

/**
 * Print reliability report to console
 */
function printReport(report: ReliabilityReport): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Reliability Report: ${report.testName}`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Iterations: ${report.iterations}`);
  console.log(`Success Rate: ${(report.successRate * 100).toFixed(1)}% (${report.successCount}/${report.iterations})`);
  console.log(`Average Duration: ${report.averageDuration.toFixed(0)}ms`);
  
  if (report.failures.length > 0) {
    console.log(`\nFailure Breakdown:`);
    for (const failure of report.failures) {
      console.log(`\n  Phase: ${failure.phase}`);
      console.log(`  Type: ${failure.errorType}`);
      console.log(`  Occurrences: ${failure.occurrences}`);
      console.log(`  Examples:`);
      for (const example of failure.exampleErrors) {
        console.log(`    - ${example}`);
      }
    }
  }
  
  console.log(`\n${"=".repeat(60)}\n`);
}
