import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

export type SimulationStateType = typeof SimulationState.State;

export const SimulationState = Annotation.Root({
  // Inputs
  updatedGameSpecVersion: Annotation<string>({
    reducer: (_, y) => y,
  }),
  gameSpecification: Annotation<string>({  
    reducer: (_, y) => y,
  }),
  playerAction: Annotation<{
    playerId: string;
    playerAction: string
  }| undefined>({
    reducer: (_, y) => y,
  }),
  players: Annotation<string[]>({
    // Only add unique players
    reducer: (x, y) => {
      return [...new Set([...x, ...y])];
    },
  }),

  // Outputs
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => [...x, ...y],
  }),
  gameRules: Annotation<string>({
    reducer: (_, y) => y,
  }),
  gameState: Annotation<string>({
    // Store raw JSON state string
    reducer: (_, y) => y,
  }),
  currentGameSpecVersion: Annotation<string>({
    reducer: (_, y) => y,
  }),
  currentRuntimeVersion: Annotation<string>({
    reducer: (_, y) => y,
  }),
  schema: Annotation<string>({  // Store processed schema as JSON string
    reducer: (_, y) => y,
  }),
  isInitialized: Annotation<boolean>({
    reducer: (_, y) => y,
  }),
});
