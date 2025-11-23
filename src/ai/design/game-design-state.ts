import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import type {
  PlayerCount,
  SpecPlan,
  GameDesignSpecification,
  GamepieceMetadata,
  ValidationError,
} from "./schemas.js";

// Re-export types for backward compatibility
export type {
  PlayerCount,
  SpecPlan,
  GameDesignSpecification,
  GamepieceMetadata,
  ValidationError,
};

export const GameDesignState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    // combine the messages because we are using a checkpointer that saves the state,
    // so we want to updated the saved state with the new messages.
    reducer: (x, y) => [ ...x, ...y ], 
  }),
  title: Annotation<string>({
    reducer: (_, y) => y, // Always take the newest title
  }),
  systemPromptVersion: Annotation<string>({
    reducer: (_, y) => y, // Always take the newest version
  }),
  specRequested: Annotation<boolean>({
    reducer: (_, y) => y,
  }),
  currentGameSpec: Annotation<GameDesignSpecification | undefined>({
    reducer: (_, y) => y,
  }),
  
  // === New fields for design workflow graph ===
  
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
  metadataChangePlan: Annotation<string | undefined>({
    reducer: (_, y) => y,
  }),
  
  // Generated content
  spec: Annotation<GameDesignSpecification | undefined>({
    reducer: (_, y) => y,
  }),
  updatedSpec: Annotation<GameDesignSpecification | undefined>({
    reducer: (_, y) => y,
  }),
  metadata: Annotation<GamepieceMetadata | undefined>({
    reducer: (_, y) => y,
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

