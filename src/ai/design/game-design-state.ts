import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import type {
  PlayerCount,
  SpecPlan,
  MetadataPlan,
  GameDesignSpecification,
  GamepieceMetadata,
  ValidationError,
} from "./schemas.js";

// Re-export types for backward compatibility
export type {
  PlayerCount,
  SpecPlan,
  MetadataPlan,
  GameDesignSpecification,
  GamepieceMetadata,
  ValidationError,
};

export const CONSOLIDATION_DEFAULTS = {
  planThreshold: 5,
  charThreshold: 2000,
} as const;

export interface BlockchainAbi {
  name: string;
  type: string;
  inputs?: Array<{
    name: string;
    type: string;
    internalType?: string;
    components?: Array<{ name: string; type: string }>;
  }>;
  outputs?: Array<{
    name: string;
    type: string;
    internalType?: string;
    components?: Array<{ name: string; type: string }>;
  }>;
  stateMutability?: string;
}

/**
 * Transform applied to raw data source response before writing to game state.
 * Shared by all data source types (blockchain and HTTP).
 */
export interface DataSourceTransform {
  /**
   * Extract a named field from the return value.
   * For tuple returns, use the output name (e.g., "answer").
   * For nested objects, use dot notation (e.g., "result.price").
   */
  extractField?: string;
  /**
   * Decimal normalization — divide raw value by 10^decimals.
   * Common values: 8 (Chainlink USD feeds), 18 (ERC-20 tokens).
   */
  decimals?: number;
  /**
   * Pick an element at this index from an array response.
   * Applied before extractField, so you can do: arrayIndex → extractField → decimals.
   * Useful for API responses that return arrays (e.g., kline candle data).
   */
  arrayIndex?: number;
  /**
   * Coerce the value to a number (parseFloat) after all other transforms.
   * Useful for HTTP APIs that return numeric values as strings (e.g., Binance).
   */
  coerceNumber?: boolean;
}

/** Fields shared by all data source types. */
export interface BaseDataSourceConfig {
  /** Unique identifier — referenced by setFromDataSource ops and game specs. */
  id: string;
  /** Human-readable label for the data source. */
  label: string;
  /** Detailed description of the data source. */
  description: string;
  /** Parameters that vary per game instance or player. */
  params: Array<{
    /** Parameter name (matches ABI param name for blockchain sources). */
    name: string;
    /** Parameter type (e.g., "address", "uint256", "string"). */
    type: string;
    /** Human-readable description for design agent summaries. */
    description?: string;
  }>;
  /** The type of the result value after transforms. */
  resultType: "number" | "string" | "boolean" | "object";
  /** Optional transform applied to the raw response before writing to game state. */
  transform?: DataSourceTransform;
}

/** Configuration for a blockchain data source (smart contract read). */
export interface BlockchainDataSourceConfig extends BaseDataSourceConfig {
  /** Discriminant for the DataSourceConfig union. */
  sourceType: "blockchain";
  /** The blockchain network where the data source resides. */
  chain: string;
  /** The unique identifier for the blockchain network. */
  chainId: number;
  /** Optional RPC URL for connecting to the blockchain network. */
  rpcUrl?: string;
  /** The smart contract address associated with the data source. */
  contract: string;
  /** The ABI (Application Binary Interface) for the smart contract. */
  abi: BlockchainAbi[];
  /** The method to call on the smart contract. */
  method: string;
  /** The Solidity return type (e.g., "uint256", "tuple"). */
  returnType: string;
}

/** Configuration for an HTTP API data source (keyless REST endpoint). */
export interface HttpDataSourceConfig extends BaseDataSourceConfig {
  /** Discriminant for the DataSourceConfig union. */
  sourceType: "http";
  /** Base URL for the API (e.g., "https://api.binance.com"). */
  baseUrl: string;
  /** URL path (e.g., "/api/v3/ticker/price"). */
  path: string;
  /**
   * Query parameters. Values can use template syntax for dynamic resolution:
   * e.g., { symbol: "{{symbol}}" } resolved from paramValues at runtime.
   * Static values are passed through as-is.
   */
  queryParams?: Record<string, string>;
}

/**
 * Union of all data source types.
 * Use `sourceType` to discriminate between blockchain and HTTP sources.
 */
export type DataSourceConfig = BlockchainDataSourceConfig | HttpDataSourceConfig;

// ─── Data Source Aggregators ─────────────────────────────────────────────────

/**
 * Aggregator type discriminants.
 * - "delayed-comparison": Reads the underlying source twice with a delay,
 *   returns { startValue, endValue, direction, delta, pctChange }.
 */
export type AggregatorType = "delayed-comparison";

/**
 * Configuration for a reusable data source aggregator.
 * Aggregators are platform-level infrastructure — they describe *how* to read
 * (not *what* to read). They compose with any compatible data source at the
 * setFromDataSource op level via `aggregatorId`.
 *
 * Aggregators live in a static registry and are resolved at runtime by ID.
 * They are NOT injected into design state (unlike data sources).
 */
export interface DataSourceAggregatorConfig {
  /** Unique identifier — referenced by setFromDataSource ops. */
  id: string;
  /** Human-readable label for descriptions and prompts. */
  label: string;
  /** Detailed description of what this aggregator does. */
  description: string;
  /** The type of aggregation pattern. */
  type: AggregatorType;
  /** Delay in milliseconds between the two reads (for delayed-comparison). */
  delayMs: number;
  /**
   * Fields returned by this aggregator.
   * Used for documentation and for validating `extractField` on ops.
   */
  resultFields: string[];
}

export const GameDesignState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    // Combine messages, filter out system messages, and keep only last 50
    // This reduces checkpoint memory usage for long-running design conversations
    reducer: (x, y) => {
      const combined = [...x, ...y];
      // Filter out system messages (internal prompts not needed in conversation history)
      const filtered = combined.filter(msg => msg.type !== "system");
      // Keep last 50 messages (sufficient for UI and prevents unbounded growth)
      return filtered.slice(-50);
    },
  }),
  title: Annotation<string>({
    reducer: (_, y) => y, // Always take the newest title
  }),
  systemPromptVersion: Annotation<string>({
    reducer: (_, y) => y, // Always take the newest version
  }),

  // Version tracking
  specVersion: Annotation<number>({
    reducer: (_, y) => y ?? 0, // Start at 0, incremented when specs are generated
  }),

  // Routing flags
  specUpdateNeeded: Annotation<boolean>({
    reducer: (_, y) => y ?? false,
  }),
  metadataUpdateNeeded: Annotation<boolean>({
    reducer: (_, y) => y ?? false,
  }),

  // Natural language change plans
  specPlan: Annotation<SpecPlan | undefined>({
    reducer: (_, y) => y,
  }),
  metadataPlan: Annotation<MetadataPlan | undefined>({
    reducer: (_, y) => y,
  }),
  // Legacy field - kept for backward compatibility, derived from metadataPlan.metadataChangePlan
  metadataChangePlan: Annotation<string | undefined>({
    reducer: (_, y) => y,
  }),

  // Generated content
  currentSpec: Annotation<GameDesignSpecification | undefined>({
    reducer: (_, y) => y,
  }),
  updatedSpec: Annotation<GameDesignSpecification | undefined>({
    reducer: (_, y) => y,
  }),
  narrativeStyleGuidance: Annotation<string | undefined>({
    reducer: (_, y) => y,
  }),
  specNarratives: Annotation<Record<string, string> | undefined>({
    reducer: (x, y) => {
      if (y === undefined) return x;
      if (x === undefined) return y;
      return { ...x, ...y };
    },
  }),
  narrativesNeedingUpdate: Annotation<string[]>({
    reducer: (_, y) => y ?? [],
  }),
  metadata: Annotation<GamepieceMetadata | undefined>({
    reducer: (_, y) => y,
  }),

  // Spec Gen Batching
  pendingSpecChanges: Annotation<SpecPlan[]>({
    reducer: (x, y) => {
      // If not provided, preserve checkpoint value
      if (y === undefined) {
        return x || [];
      }

      // If explicitly provided as empty, clear
      if (y.length === 0 && x && x.length > 0) {
        return [];
      }

      // Otherwise append (normal accumulation)
      return [...(x || []), ...y];
    },
  }),
  forceSpecGeneration: Annotation<boolean>({
    reducer: (_, y) => y ?? false,
  }),
  consolidationThreshold: Annotation<number>({
    reducer: (_, y) => y ?? CONSOLIDATION_DEFAULTS.planThreshold,
  }),
  consolidationCharLimit: Annotation<number>({
    reducer: (_, y) => y ?? CONSOLIDATION_DEFAULTS.charThreshold,
  }),

  // Diffs for user review
  specDiff: Annotation<string | undefined>({
    reducer: (_, y) => y,
  }),
  metadataDiff: Annotation<string | undefined>({
    reducer: (_, y) => y,
  }),

  // Validation
  validationErrors: Annotation<ValidationError[]>({
    reducer: (_, y) => y ?? [],
  }),
  retryCount: Annotation<number>({
    reducer: (_, y) => y ?? 0,
  }),

  // Timestamps for tracking
  lastSpecUpdate: Annotation<string | undefined>({
    reducer: (_, y) => y,
  }),
  lastMetadataUpdate: Annotation<string | undefined>({
    reducer: (_, y) => y,
  }),

  // Message count tracking (for filtering messages since last spec update)
  lastSpecMessageCount: Annotation<number | undefined>({
    reducer: (_, y) => y,
  }),

  // Data source configurations (blockchain + HTTP)
  dataSources: Annotation<DataSourceConfig[]>({
    reducer: (_, y) => y ?? [],
  }),
});

/** 
 * The default values in the reducer only apply when the value is set.  This function
 * returns the effective consolidation thresholds taking into account the defaults.
 */
export function getConsolidationThresholds(state: typeof GameDesignState.State) {
  return {
    planThreshold: state.consolidationThreshold ?? CONSOLIDATION_DEFAULTS.planThreshold,
    charThreshold: state.consolidationCharLimit ?? CONSOLIDATION_DEFAULTS.charThreshold,
  };
}
