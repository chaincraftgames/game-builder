// Action queue system to handle sequential processing of game actions
// This prevents race conditions when multiple players submit actions at the same time

// Interface for queued actions
interface QueuedAction<T> {
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
  execute: () => Promise<T>;
}

// Map of game IDs to their action queues
const gameActionQueues = new Map<string, QueuedAction<any>[]>();
// Map of game IDs to a flag indicating if queue processing is active
const processingFlags = new Map<string, boolean>();

/**
 * Queues an action for a specific game and ensures actions are processed sequentially
 * @param gameId The ID of the game
 * @param execute Function that executes the action and returns a promise with the result
 * @returns Promise that resolves with the action result
 */
export async function queueAction<T>(
  gameId: string,
  execute: () => Promise<T>
): Promise<T> {
  console.debug("[action-queues] Queueing action for game %s", gameId);
  
  // Create a new promise that will be resolved when the action is processed
  return new Promise<T>((resolve, reject) => {
    // Get or create the queue for this game
    if (!gameActionQueues.has(gameId)) {
      gameActionQueues.set(gameId, []);
    }
    
    const queue = gameActionQueues.get(gameId)!;
    
    // Add this action to the queue
    queue.push({
      resolve,
      reject,
      execute
    });
    
    // If we're not already processing the queue, start processing
    if (!processingFlags.get(gameId)) {
      void processQueue(gameId);
    }
  });
}

/**
 * Processes the queue for a specific game, ensuring actions are executed sequentially
 * @param gameId The ID of the game
 */
async function processQueue(gameId: string): Promise<void> {
  console.debug("[action-queues] Processing queue for game %s", gameId);
  
  // Set the processing flag for this game
  processingFlags.set(gameId, true);
  
  // Get the queue for this game
  const queue = gameActionQueues.get(gameId) || [];
  
  // Process queue items one by one until the queue is empty
  while (queue.length > 0) {
    const action = queue.shift()!;
    
    try {
      // Execute the action and resolve its promise with the result
      const result = await action.execute();
      action.resolve(result);
    } catch (error) {
      // If there's an error, reject the promise
      console.error("[action-queues] Error processing action for game %s: %o", gameId, error);
      action.reject(error);
    }
  }
  
  // Clear the processing flag when done
  processingFlags.set(gameId, false);
  console.debug("[action-queues] Queue processing completed for game %s", gameId);
}