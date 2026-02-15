#!/usr/bin/env node
/**
 * Import Game Script (LangGraph Checkpoints Only)
 *
 * Imports LangGraph checkpoints from an exported game into local SQLite.
 * This includes:
 * 1. Injecting design checkpoint (conversation state, spec, narratives)
 * 2. Injecting artifacts checkpoint (schema, transitions, instructions)
 * 3. Validating the import was successful
 *
 * Note: This script only handles LangGraph state. To create the Supabase games
 * record, use the orchestrator import script or create manually via Supabase Studio.
 *
 * Usage:
 *   ./internal-api.sh game-import --file data/exports/game-abc123-v2.json
 */
import "dotenv/config.js";
