import { describe, expect, test, jest } from "@jest/globals";
import { queueAction } from "#chaincraft/ai/simulate/action-queues.js";

describe("Action Queue", () => {
  test("Actions on the same game ID are processed sequentially", async () => {
    const gameId = "sequential-test-game";
    const processingOrder: string[] = [];
    const startTime = Date.now();
    
    // Create a mock action function that resolves after a delay
    const createDelayedAction = (playerId: string, delay: number) => async () => {
      await new Promise(resolve => setTimeout(resolve, delay));
      processingOrder.push(playerId);
      return { player: playerId, elapsed: Date.now() - startTime };
    };
    
    // Start multiple actions concurrently with the same game ID
    const actionPromises = [
      queueAction(gameId, createDelayedAction(crypto.randomUUID(), 50)),
      queueAction(gameId, createDelayedAction(crypto.randomUUID(), 50)),
      queueAction(gameId, createDelayedAction("player3", 50))
    ];
    
    const results = await Promise.all(actionPromises);
    
    // Verify sequential processing by checking elapsed times
    // Each action should take at least 50ms, so the second action should take at least 100ms
    // and the third at least 150ms if they're processed sequentially
    expect(results[1].elapsed - results[0].elapsed).toBeGreaterThanOrEqual(45); // Allow small tolerance
    expect(results[2].elapsed - results[1].elapsed).toBeGreaterThanOrEqual(45);
    
    // Order should be maintained
    expect(processingOrder.length).toBe(3);
  });

  test("Actions on different game IDs are processed concurrently", async () => {
    const startTime = Date.now();
    
    // Create a mock action function that resolves after a delay
    const createDelayedAction = (gameId: string, delay: number) => async () => {
      await new Promise(resolve => setTimeout(resolve, delay));
      return { game: gameId, elapsed: Date.now() - startTime };
    };
    
    // Run actions on three different game IDs
    const results = await Promise.all([
      queueAction("concurrent-game-1", createDelayedAction("concurrent-game-1", 50)),
      queueAction("concurrent-game-2", createDelayedAction("concurrent-game-2", 50)),
      queueAction("concurrent-game-3", createDelayedAction("concurrent-game-3", 50))
    ]);
    
    // If processed concurrently, all actions should complete in roughly the same time
    // (around 50ms plus a small overhead), not 150ms+ as would happen sequentially
    const maxTime = Math.max(...results.map(r => r.elapsed));
    
    // All actions should complete in around 50-100ms, allowing for some test overhead
    expect(maxTime).toBeLessThan(150);
    
    // All actions should complete in approximately the same time if run concurrently
    const minTime = Math.min(...results.map(r => r.elapsed));
    const maxTimeDifference = maxTime - minTime;
    
    expect(maxTimeDifference).toBeLessThan(50); // Allow some variance for overhead
  });
  
  test("Real-world scenario: Concurrent player moves maintain state consistency", async () => {
    // Set up shared state to track all moves
    const gameId = "rps-consistency-test";
    const actualMoves: Record<string, string> = {};
    const expectedMoves = {
      [crypto.randomUUID()]: "rock",
      [crypto.randomUUID()]: "paper",
      player3: "scissors"
    };
    
    // Create action functions that update the shared state
    const createAction = (playerId: string, move: string) => async () => {
      // Record the move in the shared state
      actualMoves[playerId] = move;
      
      // Simulate some processing delay
      await new Promise(resolve => setTimeout(resolve, 25));
      
      return { playerId, move };
    };
    
    // Submit all player moves "simultaneously" and wait for them to complete
    await Promise.all([
      queueAction(gameId, createAction(crypto.randomUUID(), "rock")),
      queueAction(gameId, createAction(crypto.randomUUID(), "paper")),
      queueAction(gameId, createAction("player3", "scissors"))
    ]);
    
    // After all actions are processed, all moves should be recorded
    expect(actualMoves).toEqual(expectedMoves);
  });
});