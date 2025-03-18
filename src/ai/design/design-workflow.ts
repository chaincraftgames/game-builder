import "dotenv/config.js";

import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import {
  StateGraph,
  END,
  START,
  BaseCheckpointSaver,
  CompiledStateGraph,
} from "@langchain/langgraph";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { GameDesignState } from "#chaincraft/ai/design/game-design-state.js";
import {
  gameDesignConversationPrompt,
  gameDesignSpecificationPrompt,
  gameDesignSpecificationTag,
  gameTitleTag,
  imageDesignPrompt,
  produceFullGameDesignPrompt,
  gameDesignSpecificationRequestTag,
} from "#chaincraft/ai/design/game-design-prompts.js";
import { getModel } from "#chaincraft/ai/model.js";
import { getSaver } from "#chaincraft/ai/memory/sqlite-memory.js";
import { OverloadedError } from "#chaincraft/ai/error.js";
import { getFileCommitHash } from "#chaincraft/util.js";
import { isActiveConversation as _isActiveConversation, registerConversationId } from "#chaincraft/ai/conversation.js";
import { imageGenTool } from "../tools.js";
import { GraphCache } from "../graph-cache.js";
import { get } from "http";
import { getConfig } from "#chaincraft/config.js";

console.log("[design-conversation] env: %o", process.env);

const graphType = getConfig("design-graph-type");

const model = await getModel(process.env.CHAINCRAFT_GAME_DESIGN_MODEL_NAME);

const designGraphCache = new GraphCache(
  createDesignGraph,
  parseInt(process.env.CHAINCRAFT_DESIGN_GRAPH_CACHE_SIZE ?? "100")
);

// Create the system message for game design
const conversationSystemMessage =
  SystemMessagePromptTemplate.fromTemplate(gameDesignConversationPrompt);

const gameTitleRegex = new RegExp(
  `.*?${gameTitleTag}(.*?)${gameTitleTag.replace('<', '</')}`,
  's'
);

const gameSpecificationRegex = new RegExp(
  `.*?${gameDesignSpecificationTag}(.*?)${gameDesignSpecificationTag.replace('<', '</')}`,
  's'
);

export type DesignResponse = {
  designResponse: string;
  updatedTitle?: string;
  systemPromptVersion?: string;
};

export async function continueDesignConversation(
  conversationId: string,
  userMessage: string,
  gameDescription?: string,
): Promise<DesignResponse> {
  // Save the conversation id
  registerConversationId(graphType, conversationId);

  // const saver = await getSaver(conversationId, graphType);
  // const graph = await _createDesignGraph(saver);
  const graph = await designGraphCache.getGraph(conversationId);
  const config = { configurable: { thread_id: conversationId } };

  // Format initial game description with XML tags if provided
  const message = gameDescription
    // ? `${produceFullGameDesignPrompt}
    ? `
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

async function _createDesignConversationNode(
  mechanicsRegistry: string
): Promise<
  (state: typeof GameDesignState.State) => Promise<typeof GameDesignState.State>
> {
  const formattedSystemMessage = await conversationSystemMessage.format({
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

    const responseContent = response.content.toString();  
    const title = _extractGameTitle(responseContent);

    // Check if this is a spec request
    if (responseContent.includes(gameDesignSpecificationRequestTag)) {
      return {
        messages: [response],
        specRequested: true,
        title: title ?? state.title,
        systemPromptVersion: promptVersion,
        currentGameSpec: state.currentGameSpec,
      };
    }
    
    // Normal conversation.  Invalidate the cached spec
    return {
      // Only return the response.  Since we are using a checkpointer to store the conversation,
      // The input message will already be stored by the checkpointer and the reducer in the state
      // will append the response to the messages array.
      messages: [response],
      title: title,
      systemPromptVersion: promptVersion,
      currentGameSpec: null,
      specRequested: false
    };
  };
}

async function _createDesignSpecificationNode(): Promise<
  (state: typeof GameDesignState.State) => Promise<typeof GameDesignState.State>
> {
  return async (state: typeof GameDesignState.State) => {
    // Filter out the AI's request message and keep previous context
    const relevantMessages = state.messages.slice(0, -1);

    const messages = [
      new SystemMessage(gameDesignSpecificationPrompt),
      ...relevantMessages,
      new HumanMessage("Please provide a complete specification for this game design.")
    ];

    const response = await model.invoke(messages).catch((error) => {
      if (error.type && error.type == "overloaded_error") {
        throw new OverloadedError(error.message);
      } else {
        throw error;
      }
    });

    const spec = _extractGameSpecification(response.content.toString());

    // Return the updated state.  Note that the messages reducer on the state
    // will append messages so we return an empty array so nothing is appended.
    return {
      ...state,
      messages: [],
      currentGameSpec: spec
    };
  };
}

async function createDesignGraph(
  conversationId: string
): Promise<CompiledStateGraph<typeof GameDesignState.State, Partial<typeof GameDesignState.State>>> {
  const saver = await getSaver(conversationId, graphType);
  return await _createDesignGraph(saver);
}

async function _createDesignGraph(
  saver: BaseCheckpointSaver
) {
  const conversationNode = await _createDesignConversationNode("");
  const specificationNode = await _createDesignSpecificationNode();

  const workflow = new StateGraph(GameDesignState);

  workflow.addNode("conversation", conversationNode);
  workflow.addNode("specification", specificationNode);

  workflow.addEdge(START, "conversation" as any);

  workflow.addConditionalEdges(
    "conversation" as any, 
    (state) => {
      if (
        state.specRequested && 
        (!state.currentGameSpec || state.currentGameSpec.length == 0)
      ) {
        return "specification";
      }
      return END;
    }
  );

  workflow.addEdge("specification" as any, END);

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
    currentGameSpec,
    specRequested,
  } of await graph.stream(inputs, {
    ...config,
    streamMode: "values",
  })) {
    // Track if we've generated a specification
    if (specRequested) {
      aiResponse = currentGameSpec && currentGameSpec.length > 0
        ? currentGameSpec
        : "No spec received.";
      continue;
    }

    // Get the last message which should be the AI's response
    const msg = messages[messages?.length - 1];

    // Only process AI messages if we haven't generated a spec
    if (!specRequested && msg?.content && msg instanceof AIMessage) {
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
  const titleMatch = content.match(gameTitleRegex);
  return titleMatch ? titleMatch[1].trim() : "";
}

function _extractGameSpecification(content: string): string {
  const specMatch = content.match(gameSpecificationRegex);
  return specMatch ? specMatch[1].trim() : "";
}
