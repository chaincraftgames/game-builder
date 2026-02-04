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
 * Tracer project names for different workflow phases
 * These match the model configuration defaults but are defined here
 * to avoid circular dependencies and provide a single source of truth
 */
const GRAPH_TRACER_PROJECTS = {
  design: process.env.CHAINCRAFT_DESIGN_TRACER_PROJECT_NAME || "chaincraft-design",
  simulation: process.env.CHAINCRAFT_SIMULATION_TRACER_PROJECT_NAME || "chaincraft-simulation",
  artifactCreation: process.env.CHAINCRAFT_ARTIFACT_CREATION_TRACER_PROJECT_NAME || "chaincraft-simulation",
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
 * @param additionalConfig - Optional additional configuration properties
 * @returns Complete graph configuration ready for graph.invoke()
 */
export function createArtifactCreationGraphConfig(
  threadId: string,
  store?: any,
  additionalConfig?: Record<string, any>
): GraphConfig {
  return {
    configurable: { thread_id: threadId },
    callbacks: createArtifactCreationGraphCallbacks(),
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
