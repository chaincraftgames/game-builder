/**
 * Type definitions for the CodeAct discovery process.
 */

/**
 * Interface for a discovered function
 */
export interface DiscoveredFunction {
  name: string;
  signature?: string;
  implementation?: string;
  description?: string;
  purpose?: string;
  importance?: string;
}

/**
 * Result of the discovery process
 */
export interface DiscoveryResult {
  gameId?: string;
  gameSpecification: string;
  functions: DiscoveredFunction[];
  stateSchema?: {
    schema: string;
    description?: string;
    [key: string]: any;
  };
}