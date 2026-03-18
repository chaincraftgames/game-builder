/**
 * Graph Configuration Module
 * 
 * Provides helpers for creating LangGraph configurations with appropriate
 * tracer callbacks based on workflow phase (design/simulation/artifact-creation).
 * 
 * Why this is needed:
 * - LangGraph creates default tracers (logging to "default" or LANGCHAIN_PROJECT env var)
 *   when callbacks are not provided in the graph config
 * - Model-level callbacks alone are insufficient - graph-level callbacks are required
 * - Each workflow phase should log to its own LangSmith project for organization
 */

import { createTracerCallbacks } from "#chaincraft/ai/model-config.js";
import type { GameCreationBus } from "#chaincraft/events/game-creation-status-bus.js";

/**
 * Graph configuration interface matching LangGraph's expected structure
 */
export interface GraphConfig {
  configurable: {
    thread_id: string;
    [key: string]: any;
  };
  callbacks?: any[];
  store?: any;
  [key: string]: any;
}

/**
 * Graph configuration for artifact creation workflows.
 * Extends GraphConfig with a typed statusBus for SSE progress events.
 */
export interface CreationGraphConfig extends GraphConfig {
  configurable: {
    thread_id: string;
    statusBus?: GameCreationBus;
    [key: string]: any;
  };
}

/**
 * Tracer project names for different workflow phases
 * These match the model configuration defaults but are defined here
 * to avoid circular dependencies and provide a single source of truth
 */
const GRAPH_TRACER_PROJECTS = {
  design: process.env.CHAINCRAFT_DESIGN_TRACER_PROJECT_NAME || "chaincraft-design",
  simulation: process.env.CHAINCRAFT_SIMULATION_TRACER_PROJECT_NAME || "chaincraft-simulation",
  artifactCreation: process.env.CHAINCRAFT_ARTIFACT_CREATION_TRACER_PROJECT_NAME || "chaincraft-simulation",
  artifactEditor: process.env.CHAINCRAFT_ARTIFACT_EDITOR_TRACER_PROJECT_NAME || "chaincraft-artifact-editor",
  play: process.env.CHAINCRAFT_PLAY_TRACER_PROJECT_NAME || "chaincraft-play",
};

/**
 * Create callbacks for design workflow graphs
 * Used by: design-workflow graph
 */
export function createDesignGraphCallbacks(): any[] {
  return createTracerCallbacks(GRAPH_TRACER_PROJECTS.design);
}

/**
 * Create callbacks for simulation workflow graphs  
 * Used by: runtime-graph (game simulation)
 */
export function createSimulationGraphCallbacks(): any[] {
  return createTracerCallbacks(GRAPH_TRACER_PROJECTS.simulation);
}

/**
 * Create callbacks for artifact creation graphs
 * Used by: spec-processing-graph (schema/transitions/instructions extraction)
 */
export function createArtifactCreationGraphCallbacks(): any[] {
  return createTracerCallbacks(GRAPH_TRACER_PROJECTS.artifactCreation);
}

/**
 * Create callbacks for artifact editor graphs
 * Used by: artifact-editor-graph when invoked standalone (sim assistant, error fix).
 * When invoked as a subgraph under spec-processing, parent callbacks propagate automatically.
 */
export function createArtifactEditorGraphCallbacks(): any[] {
  return createTracerCallbacks(GRAPH_TRACER_PROJECTS.artifactEditor);
}

/**
 * Create callbacks for play phase graphs
 * Used by: player interaction workflows
 */
export function createPlayGraphCallbacks(): any[] {
  return createTracerCallbacks(GRAPH_TRACER_PROJECTS.play);
}

/**
 * Create a graph configuration with callbacks for design workflows
 * 
 * @param threadId - Unique identifier for the graph execution thread
 * @param store - Optional LangGraph store for persistence
 * @param additionalConfig - Optional additional configuration properties
 * @returns Complete graph configuration ready for graph.invoke()
 */
export function createDesignGraphConfig(
  threadId: string,
  store?: any,
  additionalConfig?: Record<string, any>
): GraphConfig {
  return {
    configurable: { thread_id: threadId },
    callbacks: createDesignGraphCallbacks(),
    ...(store && { store }),
    ...additionalConfig,
  };
}

/**
 * Create a graph configuration with callbacks for simulation workflows
 * 
 * @param threadId - Unique identifier for the graph execution thread  
 * @param store - Optional LangGraph store for persistence
 * @param additionalConfig - Optional additional configuration properties
 * @returns Complete graph configuration ready for graph.invoke()
 */
export function createSimulationGraphConfig(
  threadId: string,
  store?: any,
  additionalConfig?: Record<string, any>
): GraphConfig {
  return {
    configurable: { thread_id: threadId },
    callbacks: createSimulationGraphCallbacks(),
    ...(store && { store }),
    ...additionalConfig,
  };
}

/**
 * Create a graph configuration with callbacks for artifact creation workflows
 * 
 * @param threadId - Unique identifier for the graph execution thread
 * @param store - Optional LangGraph store for persistence
 * @param options.statusBus - Optional SSE bus to receive per-artifact progress events
 * @returns Complete graph configuration ready for graph.invoke()
 */
export function createArtifactCreationGraphConfig(
  threadId: string,
  store?: any,
  options?: { statusBus?: GameCreationBus }
): CreationGraphConfig {
  return {
    configurable: {
      thread_id: threadId,
      ...(options?.statusBus && { statusBus: options.statusBus }),
    },
    callbacks: createArtifactCreationGraphCallbacks(),
    ...(store && { store }),
  };
}

/**
 * Create a graph configuration with callbacks for artifact editor workflows
 * Use for standalone invocations (sim assistant, error-triggered fixes).
 * When the editor runs as a subgraph under spec-processing, the parent's
 * artifact-creation callbacks propagate automatically — no config needed.
 * 
 * @param threadId - Unique identifier for the graph execution thread
 * @param store - Optional LangGraph store for persistence
 * @param additionalConfig - Optional additional configuration properties
 * @returns Complete graph configuration ready for graph.invoke()
 */
export function createArtifactEditorGraphConfig(
  threadId: string,
  store?: any,
  additionalConfig?: Record<string, any>
): GraphConfig {
  return {
    configurable: { thread_id: threadId },
    callbacks: createArtifactEditorGraphCallbacks(),
    ...(store && { store }),
    ...additionalConfig,
  };
}

/**
 * Create a graph configuration with callbacks for play workflows
 * 
 * @param threadId - Unique identifier for the graph execution thread
 * @param store - Optional LangGraph store for persistence
 * @param additionalConfig - Optional additional configuration properties  
 * @returns Complete graph configuration ready for graph.invoke()
 */
export function createPlayGraphConfig(
  threadId: string,
  store?: any,
  additionalConfig?: Record<string, any>
): GraphConfig {
  return {
    configurable: { thread_id: threadId },
    callbacks: createPlayGraphCallbacks(),
    ...(store && { store }),
    ...additionalConfig,
  };
}

/**
 * Generic helper to create graph config with explicit callbacks
 * Use this when you need custom callback configuration
 * 
 * @param threadId - Unique identifier for the graph execution thread
 * @param callbacks - Explicit callback array to use
 * @param store - Optional LangGraph store for persistence
 * @param additionalConfig - Optional additional configuration properties
 * @returns Complete graph configuration ready for graph.invoke()
 */
export function createGraphConfig(
  threadId: string,
  callbacks: any[],
  store?: any,
  additionalConfig?: Record<string, any>
): GraphConfig {
  return {
    configurable: { thread_id: threadId },
    callbacks,
    ...(store && { store }),
    ...additionalConfig,
  };
}
