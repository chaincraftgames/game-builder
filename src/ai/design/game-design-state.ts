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

export const GameDesignState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    // combine the messages because we are using a checkpointer that saves the state,
    // so we want to updated the saved state with the new messages.
    reducer: (x, y) => [...x, ...y],
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
  metadata: Annotation<GamepieceMetadata | undefined>({
    reducer: (_, y) => y,
  }),

  // Spec Gen Batching
  pendingSpecChanges: Annotation<SpecPlan[]>({
    reducer: (x, y) => {
      // If y is an empty array and x exists, this is a clear operation - replace
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
