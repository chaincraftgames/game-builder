import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

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
  currentGameSpec: Annotation<string | null>({
    reducer: (_, y) => y,
  }),
});

