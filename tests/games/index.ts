/**
 * Game Test Registry
 * 
 * Import and register all game tests here.
 */

import { rpsTest } from "./rps.test.js";
import type { GameTest } from "../harness/types.js";

export const gameTests: Record<string, GameTest> = {
  "rps": rpsTest,
  // Add more game tests here as they are created
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
