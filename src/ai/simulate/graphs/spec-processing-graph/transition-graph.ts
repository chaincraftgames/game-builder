/**
 * TransitionGraph - Query interface over transition and instruction artifacts
 * 
 * Provides path analysis and field tracking for validation without storing
 * additional data. Built from artifacts and cached in memory per thread.
 */

import {
  Transition,
  TransitionsArtifact,
  InstructionsArtifact,
  AutomaticTransitionInstruction,
} from "#chaincraft/ai/simulate/schema.js";

export interface TransitionEdge {
  transitionId: string;
  fromPhase: string;
  toPhase: string;
  transition: Transition;
  instruction?: AutomaticTransitionInstruction;
}

export interface Path {
  phases: string[];
  transitions: TransitionEdge[];
}

/**
 * Graph structure for analyzing game state transitions and instructions
 */
/**
 * Terminal phase name (required by convention)
 */
const TERMINAL_PHASE = 'finished';

export class TransitionGraph {
  private phaseEdges: Map<string, TransitionEdge[]>;
  private transitionMap: Map<string, Transition>;
  private instructionMap: Map<string, AutomaticTransitionInstruction>;
  
  constructor(
    transitionsArtifact: TransitionsArtifact,
    instructionsArtifact?: InstructionsArtifact
  ) {
    this.transitionMap = new Map(
      transitionsArtifact.transitions.map(t => [t.id, t])
    );
    this.instructionMap = instructionsArtifact
      ? new Map(Object.entries(instructionsArtifact.transitions))
      : new Map();
    
    // Build adjacency index
    this.phaseEdges = this.buildAdjacency(transitionsArtifact.transitions);
  }
  
  /**
   * Build adjacency map: phase -> outbound transitions
   */
  private buildAdjacency(transitions: Transition[]): Map<string, TransitionEdge[]> {
    const adj = new Map<string, TransitionEdge[]>();
    
    for (const t of transitions) {
      if (!adj.has(t.fromPhase)) {
        adj.set(t.fromPhase, []);
      }
      
      adj.get(t.fromPhase)!.push({
        transitionId: t.id,
        fromPhase: t.fromPhase,
        toPhase: t.toPhase,
        transition: t,
        instruction: this.instructionMap.get(t.id)
      });
    }
    
    return adj;
  }
  
  /**
   * Get the terminal phase name (always "finished" by convention)
   */
  getTerminalPhase(): string {
    return TERMINAL_PHASE;
  }
  
  /**
   * Get all paths from one phase to another with cycle detection
   */
  getPathsFromTo(fromPhase: string, toPhase: string, maxDepth: number = 20): Path[] {
    const paths: Path[] = [];
    
    const dfs = (current: string, path: TransitionEdge[], visited: Set<string>) => {
      // Cycle detection - don't revisit phases in current path
      if (visited.has(current)) return;
      
      // Depth limit to prevent runaway recursion
      if (path.length > maxDepth) return;
      
      // Found target
      if (current === toPhase) {
        paths.push({
          phases: this.extractPhases(path),
          transitions: path
        });
        return;
      }
      
      // Explore neighbors
      const edges = this.phaseEdges.get(current) || [];
      const newVisited = new Set(visited).add(current);
      
      for (const edge of edges) {
        dfs(edge.toPhase, [...path, edge], newVisited);
      }
    };
    
    dfs(fromPhase, [], new Set());
    return paths;
  }
  
  /**
   * Get all paths from init to the terminal "finished" phase
   */
  getTerminalPaths(): Path[] {
    return this.getPathsFromTo('init', TERMINAL_PHASE);
  }
  
  /**
   * Check if a field is set in any transition along a path
   */
  pathSetsField(path: Path, fieldPath: string): boolean {
    return path.transitions.some(edge => 
      this.transitionSetsField(edge, fieldPath)
    );
  }
  
  /**
   * Check if a specific transition sets a field
   * Handles:
   * - Exact matches: path === fieldPath
   * - Wildcard matching: players.* matches players.{{winnerId}}, players.player1, etc.
   * - Template variables treated as wildcards: {{winnerId}} matches *
   */
  private transitionSetsField(edge: TransitionEdge, fieldPath: string): boolean {
    if (!edge.instruction?.stateDelta) return false;
    
    return edge.instruction.stateDelta.some((op: any) => {
      const isSetOp = op.op === 'set' || op.op === 'append' || op.op === 'increment';
      if (!isSetOp) return false;
      
      // Normalize paths for comparison:
      // - Replace {{templateVar}} with * for wildcard matching
      // - Split into segments for segment-by-segment comparison
      const normalizedOpPath = this.normalizePath(op.path);
      const normalizedFieldPath = this.normalizePath(fieldPath);
      
      return this.pathsMatch(normalizedOpPath, normalizedFieldPath);
    });
  }
  
  /**
   * Normalize a path by replacing template variables with wildcards
   * Example: "players.{{winnerId}}.score" -> "players.*.score"
   */
  private normalizePath(path: string): string {
    return path.replace(/\{\{[^}]+\}\}/g, '*');
  }
  
  /**
   * Check if two normalized paths match (with wildcard support)
   * Example: "players.*.score" matches "players.*.score"
   */
  private pathsMatch(path1: string, path2: string): boolean {
    const segments1 = path1.split('.');
    const segments2 = path2.split('.');
    
    if (segments1.length !== segments2.length) return false;
    
    for (let i = 0; i < segments1.length; i++) {
      const seg1 = segments1[i];
      const seg2 = segments2[i];
      
      // Either both are wildcards, or one is wildcard and matches anything, or exact match
      if (seg1 === '*' || seg2 === '*' || seg1 === seg2) {
        continue;
      }
      
      return false;
    }
    
    return true;
  }
  
  /**
   * Find all transitions that set a specific field
   */
  findFieldSetters(fieldPath: string): TransitionEdge[] {
    const setters: TransitionEdge[] = [];
    
    for (const edges of this.phaseEdges.values()) {
      for (const edge of edges) {
        if (this.transitionSetsField(edge, fieldPath)) {
          setters.push(edge);
        }
      }
    }
    
    return setters;
  }
  
  /**
   * Check if a phase is reachable from init
   */
  isReachableFromInit(targetPhase: string): boolean {
    const visited = new Set<string>();
    const queue = ['init'];
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      
      if (current === targetPhase) return true;
      if (visited.has(current)) continue;
      
      visited.add(current);
      
      const edges = this.phaseEdges.get(current) || [];
      for (const edge of edges) {
        queue.push(edge.toPhase);
      }
    }
    
    return false;
  }
  
  /**
   * Get all reachable phases from init
   */
  getReachablePhasesFromInit(): Set<string> {
    const reachable = new Set<string>();
    const queue = ['init'];
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      
      if (reachable.has(current)) continue;
      reachable.add(current);
      
      const edges = this.phaseEdges.get(current) || [];
      for (const edge of edges) {
        queue.push(edge.toPhase);
      }
    }
    
    return reachable;
  }
  
  /**
   * Extract ordered phase list from transition path
   */
  private extractPhases(path: TransitionEdge[]): string[] {
    if (path.length === 0) return [];
    return [path[0].fromPhase, ...path.map(e => e.toPhase)];
  }
}

/**
 * Module-level cache for transition graphs
 * Keyed by: threadId:transitionsHash:instructionsHash
 */
const graphCache = new Map<string, TransitionGraph>();

/**
 * Simple hash function for cache keys
 */
function hashCode(obj: any): string {
  const str = JSON.stringify(obj);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString();
}

/**
 * Get or build a cached TransitionGraph
 * 
 * @param threadId - LangGraph thread ID
 * @param transitionsArtifact - Transitions artifact
 * @param instructionsArtifact - Optional instructions artifact
 * @returns Cached or newly built TransitionGraph
 */
export function getOrBuildGraph(
  threadId: string,
  transitionsArtifact: TransitionsArtifact,
  instructionsArtifact?: InstructionsArtifact
): TransitionGraph {
  // Build cache key from thread ID and artifact hashes
  const transitionsHash = hashCode(transitionsArtifact);
  const instructionsHash = instructionsArtifact ? hashCode(instructionsArtifact) : 'none';
  const cacheKey = `${threadId}:${transitionsHash}:${instructionsHash}`;
  
  // Check cache
  let graph = graphCache.get(cacheKey);
  
  if (!graph) {
    // Cache miss - build new graph
    console.debug(`[TransitionGraph] Building graph for ${cacheKey}`);
    graph = new TransitionGraph(transitionsArtifact, instructionsArtifact);
    graphCache.set(cacheKey, graph);
    
    // LRU cleanup - keep only recent 50 graphs
    if (graphCache.size > 50) {
      const firstKey = graphCache.keys().next().value;
      if (firstKey) {
        graphCache.delete(firstKey);
      }
    }
  }
  
  return graph;
}

/**
 * Clear the graph cache (useful for testing)
 */
export function clearGraphCache(): void {
  graphCache.clear();
}
