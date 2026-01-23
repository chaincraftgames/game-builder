/**
 * Game Test Registry
 * 
 * Import and register all game tests here.
 */

import { dirname } from "path";
import { fileURLToPath } from "url";
import { rpsTest } from "./rps.test.js";
import { westwardPerilTest } from "./westward-peril.test.js";
import { wackyWeaponsRouterBugTest } from "./wacky-weapons-router-bug.test.js";
import type { GameTest } from "../harness/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const gameTests: Record<string, GameTest> = {
  "rps": rpsTest,
  "westward-peril": westwardPerilTest,
  "wacky-weapons-router-bug": wackyWeaponsRouterBugTest,
};

export function getGameTest(name: string): GameTest | undefined {
  return gameTests[name];
}

export function getAllGameTests(): GameTest[] {
  return Object.values(gameTests);
}

export function listGameTestNames(): string[] {
  return Object.keys(gameTests);
}

/**
 * Get the directory where game test files are located.
 * Used for resolving relative artifact file paths.
 */
export function getGameTestsDirectory(): string {
  return __dirname;
}
