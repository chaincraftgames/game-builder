/**
 * Test Logger
 * 
 * Captures and saves test execution logs and results to files for later analysis.
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { TestResult } from "./types.js";

const LOG_DIR = join(process.cwd(), "test-results");

// Ensure log directory exists
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Save test result to JSON file
 */
export function saveTestResult(
  gameName: string,
  scenarioIndex: number,
  result: TestResult,
  gameId: string
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${gameName}-scenario${scenarioIndex}-${timestamp}.json`;
  const filepath = join(LOG_DIR, filename);
  
  const logData = {
    gameName,
    scenarioIndex,
    gameId,
    timestamp: new Date().toISOString(),
    result: {
      ...result,
      // Include a summary at the top for easy scanning
      summary: {
        passed: result.passed,
        artifactsGenerated: result.artifactsGenerated,
        simulationCompleted: result.simulationCompleted,
        turns: result.turns,
        duration: result.duration,
        hasError: !!(result.simulationError || result.artifactErrors),
      }
    }
  };
  
  writeFileSync(filepath, JSON.stringify(logData, null, 2), "utf-8");
  console.log(`\n[test-logger] Results saved to: ${filepath}`);
  
  return filepath;
}

/**
 * Console capture for saving full test output
 */
export class ConsoleCapture {
  private logs: Array<{ level: string; args: any[]; timestamp: string }> = [];
  private originalConsole: {
    log: typeof console.log;
    error: typeof console.error;
    warn: typeof console.warn;
    debug: typeof console.debug;
  };
  
  constructor() {
    this.originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      debug: console.debug,
    };
  }
  
  /**
   * Start capturing console output
   */
  start(): void {
    const capture = (level: string) => (...args: any[]) => {
      this.logs.push({
        level,
        args,
        timestamp: new Date().toISOString(),
      });
      // Still output to console
      this.originalConsole[level as keyof typeof this.originalConsole](...args);
    };
    
    console.log = capture("log");
    console.error = capture("error");
    console.warn = capture("warn");
    console.debug = capture("debug");
  }
  
  /**
   * Stop capturing and restore original console
   */
  stop(): void {
    console.log = this.originalConsole.log;
    console.error = this.originalConsole.error;
    console.warn = this.originalConsole.warn;
    console.debug = this.originalConsole.debug;
  }
  
  /**
   * Save captured logs to file
   */
  save(gameName: string, scenarioIndex: number, gameId: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${gameName}-scenario${scenarioIndex}-${timestamp}.log`;
    const filepath = join(LOG_DIR, filename);
    
    const logText = this.logs.map(entry => {
      const time = new Date(entry.timestamp).toISOString();
      const message = entry.args.map(arg => 
        typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(" ");
      return `[${time}] [${entry.level.toUpperCase()}] ${message}`;
    }).join("\n");
    
    writeFileSync(filepath, logText, "utf-8");
    console.log(`[test-logger] Console logs saved to: ${filepath}`);
    
    return filepath;
  }
  
  /**
   * Get all captured logs
   */
  getLogs() {
    return this.logs;
  }
  
  /**
   * Clear captured logs
   */
  clear(): void {
    this.logs = [];
  }
}
