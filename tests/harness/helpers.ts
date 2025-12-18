/**
 * Test Harness Helper Functions
 */

/**
 * Generate a random player ID using UUID format
 */
export function createPlayerId(): string {
  return crypto.randomUUID();
}

/**
 * Generate multiple player IDs at once
 */
export function createPlayerIds(count: number): string[] {
  return Array.from({ length: count }, () => createPlayerId());
}

/**
 * Generate a unique game ID for a test run
 */
export function createGameId(testName?: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  const prefix = testName ? testName.toLowerCase().replace(/\s+/g, '-') : 'test';
  return `${prefix}-${timestamp}-${random}`;
}
