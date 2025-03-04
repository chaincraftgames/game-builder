import "dotenv/config.js";

import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import {
  StateGraph,
  END,
  START,
  MemorySaver,
  BaseCheckpointSaver,
} from "@langchain/langgraph";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { GameDesignState } from "#chaincraft/ai/design/game-design-state.js";
import {
  gameDesignPrompt,
  imageDesignPrompt,
  produceFullGameDesignPrompt,
} from "#chaincraft/ai/design/game-design-prompts.js";
import { getModel } from "#chaincraft/ai/model.js";
import { getSaver } from "#chaincraft/ai/util/sqlite-memory.js";
import { OverloadedError } from "#chaincraft/ai/error.js";
import { getFileCommitHash } from "#chaincraft/util.js";
import { isActiveConversation as _isActiveConversation, registerConversationId } from "#chaincraft/ai/conversation.js";
import { imageGenTool } from "../tools.js";

console.log("[design-conversation] env: %o", process.env);

const graphType = "game-design";

const model = await getModel(process.env.GAME_DESIGN_MODEL_NAME);

// Create the system message for game design
const systemMessage =
  SystemMessagePromptTemplate.fromTemplate(gameDesignPrompt);

export type DesignResponse = {
  designResponse: string;
  updatedTitle?: string;
  systemPromptVersion?: string;
};

export async function continueDesignConversation(
  conversationId: string,
  userMessage: string,
  gameDescription?: string
): Promise<DesignResponse> {
  // Save the conversation id
  registerConversationId(graphType, conversationId);

  const saver = await getSaver(conversationId, graphType);
  const graph = await _createDesignGraph(saver);
  const config = { configurable: { thread_id: conversationId } };

  // Format initial game description with XML tags if provided
  const message = gameDescription
    ? `${produceFullGameDesignPrompt}
    <game_description>
    ${gameDescription}
    </game_description>`
    : userMessage;

  return _processMessage(graph, message, config);
}

export async function generateImage(conversationId: string): Promise<string> {
  const gameDesignSpec = await getFullDesignSpecification(conversationId);
  if (!gameDesignSpec) {
    throw new Error("Failed to generate image: no game design spec");
  }

  const imageDesign = await model.invoke([
    new SystemMessage(imageDesignPrompt),
    new HumanMessage(
      `<game_design_specification>
      ${gameDesignSpec}
      </game_design_specification>`
    ),
  ])
  .catch((error) => {
    if (error.type && error.type == "overloaded_error") {
      throw new OverloadedError(error.message);
    } else {
      throw error;
    }
  });
  if (!imageDesign.content) {
    throw new Error("Failed to generate image: no content");
  }

  const imageUrl = await imageGenTool.invoke(imageDesign.content.toString());
  if (!imageUrl) {
    throw new Error("Failed to generate image: no image URL");
  }
  return imageUrl;
}

export async function getFullDesignSpecification(
  conversationId: string
): Promise<string> {
  const { designResponse: gameDesignSpec } = await continueDesignConversation(
    conversationId,
    produceFullGameDesignPrompt
  );
  return gameDesignSpec;
}

export async function isActiveConversation(
  conversationId: string
): Promise<boolean> {
  return _isActiveConversation(graphType, conversationId);
}

async function _createDesignNode(
  mechanicsRegistry: string
): Promise<
  (state: typeof GameDesignState.State) => Promise<typeof GameDesignState.State>
> {
  const formattedSystemMessage = await systemMessage.format({
    mechanics_registry: mechanicsRegistry,
  });

  // Get the commit hash for the system prompt file
  const promptVersion = await getFileCommitHash(
    "./src/ai/design/game-design-prompts.ts"
  );

  return async (state: typeof GameDesignState.State) => {
    const messages = [
      new SystemMessage(formattedSystemMessage),
      ...state.messages,
    ];

    console.log(
      "Messages being sent to model:",
      messages.map((m) => m.content.toString().substring(0, 100))
    );

    const response = await model.invoke(messages).catch((error) => {
      if (error.type && error.type == "overloaded_error") {
        throw new OverloadedError(error.message);
      } else {
        throw error;
      }
    });
    const title = _extractGameTitle(response.content.toString());

    return {
      // Only return the response.  Since we are using a checkpointer to store the conversation,
      // The input message will already be stored by the checkpointer and the reducer in the state
      // will append the response to the messages array.
      messages: [response],
      title: title,
      systemPromptVersion: promptVersion,
    };
  };
}

async function _createDesignGraph(
  saver: BaseCheckpointSaver,
  { mechanicsRegistry = "" }: { mechanicsRegistry?: string } = {}
) {
  const designNode = await _createDesignNode(mechanicsRegistry);

  const workflow = new StateGraph(GameDesignState);

  workflow.addNode("design", designNode);
  workflow.addEdge(START, "design" as any);
  workflow.addEdge("design" as any, END);

  return workflow.compile({ checkpointer: saver });
}

async function _processMessage(
  graph: any,
  content: string,
  config: { configurable: { thread_id: string } }
): Promise<DesignResponse> {
  const inputs = { messages: [new HumanMessage(content)] };
  let aiResponse = "";
  let lastTitle = "";
  let lastPromptVersion = "";

  for await (const {
    messages,
    title,
    systemPromptVersion,
  } of await graph.stream(inputs, {
    ...config,
    streamMode: "values",
  })) {
    // Get the last message which should be the AI's response
    const msg = messages[messages?.length - 1];

    // Only process the AI's response content
    if (msg?.content && msg instanceof AIMessage) {
      aiResponse = msg.content
        .toString()
        .replace(/<game_title>.*?<\/game_title>\n?/g, "");
    }

    if (title) {
      lastTitle = title;
    }

    lastPromptVersion = systemPromptVersion;
  }

  return {
    designResponse: aiResponse.length > 0 ? aiResponse : "No response",
    updatedTitle: lastTitle,
    systemPromptVersion: lastPromptVersion,
  };
}

function _extractGameTitle(content: string): string {
  const titleMatch = content.match(/<game_title>(.*?)<\/game_title>/);
  return titleMatch ? titleMatch[1].trim() : "";
}
