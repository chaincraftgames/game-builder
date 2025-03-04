import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import path from "path";
import fs from "fs/promises";

// Track savers by database
interface DatabaseState {
  dbPath: string;
  savers: Map<string, SqliteSaver>;
}

const databases = new Map<string, DatabaseState>();
let isInitialized = false;

async function initialize() {
  if (isInitialized) return;

  // Ensure data directory exists
  const dataDir = path.join(process.cwd(), "data");
  await fs.mkdir(dataDir, { recursive: true });

  isInitialized = true;
}

async function getOrCreateDatabase(graphType: string): Promise<DatabaseState> {
  if (!databases.has(graphType)) {
    const dbPath = path.join(process.cwd(), "data", `${graphType}-memory.db`);
    databases.set(graphType, {
      dbPath,
      savers: new Map(),
    });
  }
  return databases.get(graphType)!;
}

export async function getSaver(
  sessionId: string,
  graphType: string
): Promise<SqliteSaver> {
  await initialize();

  const db = await getOrCreateDatabase(graphType);
  if (!db.savers.has(sessionId)) {
    try {
      const saver = SqliteSaver.fromConnString(db.dbPath);
      db.savers.set(sessionId, saver);
    } catch (error) {
      console.error(`Failed to create saver for ${sessionId}: ${error}`);
      throw error;
    }
  }
  return db.savers.get(sessionId)!;
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
