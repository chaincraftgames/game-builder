import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { Pool } from "pg";
import path from "path";
import fs from "fs/promises";

// Union type for both saver types
type CheckpointSaver = SqliteSaver | PostgresSaver;

// Database backend type
type DatabaseBackend = "sqlite" | "postgres";

// Track savers by database
interface DatabaseState {
  dbPath?: string;
  connectionString?: string;
  // For SQLite: one saver per sessionId (maintains current behavior)
  // For PostgreSQL: one shared saver per graphType (more efficient)
  savers: Map<string, CheckpointSaver>;
  sharedSaver?: CheckpointSaver; // Used for PostgreSQL
  backend: DatabaseBackend;
}

const databases = new Map<string, DatabaseState>();
let isInitialized = false;

// Get database backend from environment variable
function getDatabaseBackend(): DatabaseBackend {
  const dbType = process.env.CHECKPOINT_DB_TYPE?.toLowerCase();
  if (dbType === "postgres" || dbType === "postgresql") {
    return "postgres";
  }
  return "sqlite"; // Default to SQLite
}

async function initialize() {
  if (isInitialized) return;

  const backend = getDatabaseBackend();

  if (backend === "sqlite") {
    // Ensure data directory exists for SQLite
    const dataDir = path.join(process.cwd(), "data");
    await fs.mkdir(dataDir, { recursive: true });
  } else if (backend === "postgres") {
    // Validate PostgreSQL connection string is provided
    if (!process.env.POSTGRES_CONNECTION_STRING) {
      throw new Error(
        "POSTGRES_CONNECTION_STRING environment variable is required when CHECKPOINT_DB_TYPE=postgres"
      );
    }
  }

  isInitialized = true;
}

async function getOrCreateDatabase(graphType: string): Promise<DatabaseState> {
  if (!databases.has(graphType)) {
    const backend = getDatabaseBackend();
    const state: DatabaseState = {
      savers: new Map(),
      backend,
    };

    if (backend === "sqlite") {
      state.dbPath = path.join(process.cwd(), "data", `${graphType}-memory.db`);
    } else {
      state.connectionString = process.env.POSTGRES_CONNECTION_STRING;
    }

    databases.set(graphType, state);
  }
  return databases.get(graphType)!;
}

async function setupPostgresSaver(connectionString: string): Promise<PostgresSaver> {
  // Create pool with configuration to prevent memory leaks
  const pool = new Pool({
    connectionString,
    max: 10,                      // Maximum 10 connections
    idleTimeoutMillis: 30000,     // Disconnect idle clients after 30 seconds
    connectionTimeoutMillis: 5000, // Timeout if can't connect within 5 seconds
  });

  const saver = new PostgresSaver(pool);
  
  // setup() creates the necessary tables if they don't exist.
  // In practice, this can sometimes race or re-run against an already-initialized
  // database and throw a duplicate-key error (code 23505). Treat that as
  // \"already set up\" and continue.
  try {
    await saver.setup();
  } catch (error: any) {
    if (error?.code === "23505") {
      console.warn(
        "[checkpoint-memory] Postgres checkpoint schema already exists; continuing."
      );
    } else {
      throw error;
    }
  }
  return saver;
}

export async function getSaver(
  sessionId: string,
  graphType: string
): Promise<CheckpointSaver> {
  await initialize();

  const db = await getOrCreateDatabase(graphType);
  
  if (db.backend === "postgres") {
    // For PostgreSQL, use a shared saver per graphType (more efficient)
    if (!db.sharedSaver) {
      if (!db.connectionString) {
        throw new Error(`PostgreSQL connection string not set for ${graphType}`);
      }
      
      try {
        // Setup PostgreSQL tables and create singleton saver (only once per graph type)
        db.sharedSaver = await setupPostgresSaver(db.connectionString);
      } catch (error) {
        console.error(`Failed to create PostgreSQL saver for ${graphType}: ${error}`);
        throw error;
      }
    }
    
    return db.sharedSaver;
  } else {
    // For SQLite, maintain current behavior: one saver per sessionId
    if (!db.savers.has(sessionId)) {
      if (!db.dbPath) {
        throw new Error(`Database path not set for ${graphType}`);
      }
      
      try {
        const saver = SqliteSaver.fromConnString(db.dbPath);
        db.savers.set(sessionId, saver);
      } catch (error) {
        console.error(`Failed to create SQLite saver for ${sessionId} (${graphType}): ${error}`);
        throw error;
      }
    }
    
    return db.savers.get(sessionId)!;
  }
}

export async function deleteThread(
  threadId: string,
  graphType: string
): Promise<void> {
  await initialize();
  
  const db = await getOrCreateDatabase(graphType);
  const saver = db.backend === "postgres" && db.sharedSaver 
    ? db.sharedSaver 
    : await getSaver(threadId, graphType);

  if (!saver) {
    console.warn(`[checkpoint-cleanup] No saver found for thread ${threadId}, skipping`);
    return;
  }

  try {
    // Use the saver's delete method to remove all checkpoints for this thread
    await saver.deleteThread(threadId);
    console.log(`[checkpoint-cleanup] Deleted thread ${threadId} from ${graphType}`);
  } catch (error) {
    console.error(`[checkpoint-cleanup] Error deleting thread ${threadId}:`, error);
    throw error;
  }
}

export async function cleanup(
  graphType: string,
  olderThanDays: number = 7
): Promise<void> {
  await initialize();

  const db = await getOrCreateDatabase(graphType);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
  const cutoffTimestamp = cutoffDate.getTime();

  console.log(
    `[checkpoint-cleanup] Cleaning up ${graphType} threads older than ${cutoffDate.toISOString()}`
  );

  let deletedCount = 0;
  const seenThreads = new Set<string>();
  
  // Get the appropriate saver
  const saver = db.backend === "postgres" && db.sharedSaver 
    ? db.sharedSaver 
    : db.savers.values().next().value;

  if (!saver) {
    console.log(`[checkpoint-cleanup] No saver found for ${graphType}, skipping`);
    return;
  }

  try {
    // Single pass: saver.list() returns checkpoints in reverse chronological order
    // The first checkpoint we see for each thread is the latest one
    for await (const checkpoint of saver.list({}, { limit: undefined })) {
      const threadId = checkpoint.config?.configurable?.thread_id;
      if (!threadId) continue;

      // Only process the first (latest) checkpoint for each thread
      if (!seenThreads.has(threadId)) {
        seenThreads.add(threadId);
        
        const checkpointTime = new Date(checkpoint.checkpoint.ts).getTime();

        // Check if this thread's latest checkpoint is older than cutoff
        if (checkpointTime < cutoffTimestamp) {
          // For simulation threads, check if the game has actually ended
          let shouldDelete = true;
          if (graphType.includes('simulation')) {
            const channelValues = checkpoint.checkpoint.channel_values as any;
            if (channelValues?.gameState) {
              try {
                const gameState = typeof channelValues.gameState === 'string'
                  ? JSON.parse(channelValues.gameState)
                  : channelValues.gameState;
                
                // Only delete if game has ended
                if (!gameState?.game?.gameEnded) {
                  shouldDelete = false;
                  console.log(
                    `[checkpoint-cleanup] Skipping thread ${threadId} - game still active (last activity: ${new Date(checkpointTime).toISOString()})`
                  );
                }
              } catch (error) {
                console.warn(`[checkpoint-cleanup] Could not parse gameState for thread ${threadId}, will delete anyway`);
              }
            }
          }

          if (shouldDelete) {
            try {
              await saver.deleteThread(threadId);
              deletedCount++;
              console.log(
                `[checkpoint-cleanup] Deleted thread ${threadId} (last activity: ${new Date(checkpointTime).toISOString()})`
              );
            } catch (error) {
              console.error(`[checkpoint-cleanup] Failed to delete thread ${threadId}:`, error);
            }
          }
        }
      }
    }

    console.log(
      `[checkpoint-cleanup] Deleted ${deletedCount} thread(s) from ${graphType}`
    );
    
  } catch (error) {
    console.error(`[checkpoint-cleanup] Error during cleanup for ${graphType}:`, error);
    throw error;
  }
}
