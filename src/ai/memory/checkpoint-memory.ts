import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
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
  isSetup: boolean;
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
      isSetup: false,
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
  const saver = PostgresSaver.fromConnString(connectionString);
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
        // Setup PostgreSQL tables on first use (only once per graph type)
        // setupPostgresSaver creates the saver and sets up tables, so reuse it
        if (!db.isSetup) {
          db.sharedSaver = await setupPostgresSaver(db.connectionString);
          db.isSetup = true;
        } else {
          // If already set up, just create the saver (no need to setup again)
          db.sharedSaver = PostgresSaver.fromConnString(db.connectionString);
        }
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

export async function cleanup(
  graphType: string,
  olderThanDays: number = 7
): Promise<void> {
  await initialize();

  const db = await getOrCreateDatabase(graphType);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  console.log(
    `Cleaning up ${graphType} sessions older than ${cutoffDate.toISOString()}`
  );
}
