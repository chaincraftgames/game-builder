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
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";
import {
  GameDesignSpecification,
  GameDesignState,
  PlayerCount,
} from "#chaincraft/ai/design/game-design-state.js";
import {
  gameDesignConversationPrompt,
  gameDesignSpecificationPrompt,
  gameDesignSpecificationTag,
  gameTitleTag,
  imageDesignPrompt,
  produceFullGameDesignPrompt,
  gameDesignSpecificationRequestTag,
  gameSummaryTag,
  gamePlayerCountTag,
  imageGenPrompt,
} from "#chaincraft/ai/design/game-design-prompts.js";
import { getModel } from "#chaincraft/ai/model.js";
import { getSaver } from "#chaincraft/ai/memory/sqlite-memory.js";
import { OverloadedError } from "#chaincraft/ai/error.js";
import { getFileCommitHash } from "#chaincraft/util.js";
import {
  isActiveConversation as _isActiveConversation,
  registerConversationId,
} from "#chaincraft/ai/conversation.js";
import { imageGenTool } from "#chaincraft/ai/tools.js";
import { GraphCache } from "#chaincraft/ai/graph-cache.js";
import { getConfig } from "#chaincraft/config.js";
import { constraintsRegistry, getConstraintsRegistry } from "./design-data.js";
import { logApplicationEvent, logSecretStatus } from "#chaincraft/util/safe-logging.js";

// Log safe application startup info
logApplicationEvent('design-workflow', 'initializing', { 
  cacheSize: parseInt(process.env.CHAINCRAFT_DESIGN_GRAPH_CACHE_SIZE ?? "100") 
});

// Check that required secrets are available without logging their values
logSecretStatus('CHAINCRAFT_GAME_DESIGN_MODEL_NAME', process.env.CHAINCRAFT_GAME_DESIGN_MODEL_NAME);

const graphType = getConfig("design-graph-type");

const model = await getModel(process.env.CHAINCRAFT_GAME_DESIGN_MODEL_NAME);

const designGraphCache = new GraphCache(
  createDesignGraph,
  parseInt(process.env.CHAINCRAFT_DESIGN_GRAPH_CACHE_SIZE ?? "100")
);

const chaincraftDesignTracer = new LangChainTracer({
  projectName: process.env.CHAINCRAFT_DESIGN_TRACER_PROJECT_NAME,
});

// Create the system message for game design
const conversationSystemMessage = SystemMessagePromptTemplate.fromTemplate(
  gameDesignConversationPrompt
);

const imageGenSystemMessage =
  SystemMessagePromptTemplate.fromTemplate(imageGenPrompt);

const gameTitleRegex = new RegExp(
  `.*?${gameTitleTag}(.*?)${gameTitleTag.replace("<", "</")}`,
  "s"
);

const gameSpecificationRegex = new RegExp(
  `.*?${gameDesignSpecificationTag}(.*?)${gameDesignSpecificationTag.replace(
    "<",
    "</"
  )}`,
  "s"
);

const gameSummaryRegex = new RegExp(
  `.*?${gameSummaryTag}(.*?)${gameSummaryTag.replace("<", "</")}`,
  "s"
);

const gamePlayerCountRegex = new RegExp(
  `.*?${gamePlayerCountTag}(.*?)${gamePlayerCountTag.replace("<", "</")}`,
  "s"
);

export type DesignResponse = {
  designResponse: string;
  updatedTitle?: string;
  systemPromptVersion?: string;
  specification?: {
    summary: string;
    playerCount: {
      min: number;
      max: number;
    };
    designSpecification: string;
  };
};

export async function continueDesignConversation(
  conversationId: string,
  userMessage: string,
  gameDescription?: string
): Promise<DesignResponse> {
  // Save the conversation id
  registerConversationId(graphType, conversationId);

  // const saver = await getSaver(conversationId, graphType);
  // const graph = await _createDesignGraph(saver);
  const graph = await designGraphCache.getGraph(conversationId);
  const config = { configurable: { thread_id: conversationId } };

  // Format initial game description with XML tags if provided
  const message = gameDescription
    ? // ? `${produceFullGameDesignPrompt}
      `
    <game_description>
    ${gameDescription}
    </game_description>`
    : userMessage;

  return _processMessage(graph, message, config);
}

export async function generateImage(conversationId: string): Promise<string> {
  const specAndTitle = await getFullDesignSpecification(conversationId);
  if (!specAndTitle) {
    throw new Error("Failed to generate image: no game design spec");
  }

  const { summary, title } = specAndTitle;

  const imageDesign = await model.invoke(
    [
      new SystemMessage(imageDesignPrompt),
      new HumanMessage(
        `<game_design_specification>
        ${summary}
        </game_design_specification>`
      ),
    ],
    {
      callbacks: [
        chaincraftDesignTracer,
      ]
    }
  )
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

  const imageGenPrompt = await imageGenSystemMessage.format({
    // game_summary: summary,
    image_description: imageDesign.content.toString().substring(0, 600),
    game_title: title,
  });
  const imageUrl = await imageGenTool
    .invoke(imageGenPrompt.content, {
      callbacks: [chaincraftDesignTracer],
    })
    .catch((error) => {
      if (error.type && error.type == "overloaded_error") {
        throw new OverloadedError(error.message);
      } else {
        throw error;
      }
    });
  if (!imageUrl) {
    throw new Error("Failed to generate image: no image URL");
  }
  return imageUrl;
}

export async function getFullDesignSpecification(
  conversationId: string
): Promise<(GameDesignSpecification & { title: string }) | undefined> {
  const designResponse = await continueDesignConversation(
    conversationId,
    produceFullGameDesignPrompt
  );

  if (!designResponse.specification) {
    return undefined;
  }

  return {
    ...designResponse.specification,
    title: designResponse.updatedTitle ?? "",
  };
}

export async function isActiveConversation(
  conversationId: string
): Promise<boolean> {
  return _isActiveConversation(graphType, conversationId);
}

async function _createDesignConversationNode(
  mechanicsRegistry: string,
  constraintsRegistry: string
): Promise<
  (state: typeof GameDesignState.State) => Promise<typeof GameDesignState.State>
> {
  const formattedSystemMessage = await conversationSystemMessage.format({
    mechanics_registry: mechanicsRegistry,
    constraints_registry: constraintsRegistry,
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

    const response = await model
      .invoke(messages, {
        callbacks: [chaincraftDesignTracer],
      })
      .catch((error) => {
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
      currentGameSpec: undefined,
      specRequested: false,
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
      new HumanMessage(
        "Please provide a complete specification for this game design."
      ),
    ];

    const response = await model
      .invoke(messages, {
        callbacks: [chaincraftDesignTracer],
      })
      .catch((error) => {
        if (error.type && error.type == "overloaded_error") {
          throw new OverloadedError(error.message);
        } else {
          throw error;
        }
      });

    const designSpecification = _extractDesignSpecification(
      response.content.toString()
    );
    const summary =
      _extractGameSummary(response.content.toString()) ??
      "No summary provided.";
    const playerCount = _extractPlayerCount(response.content.toString()) ?? {
      min: 1,
      max: 4,
    };

    // Return the updated state.  Note that the messages reducer on the state
    // will append messages so we return an empty array so nothing is appended.
    return {
      ...state,
      messages: [],
      currentGameSpec: {
        summary,
        playerCount,
        designSpecification,
      },
    };
  };
}

async function createDesignGraph(
  conversationId: string
): Promise<
  CompiledStateGraph<
    typeof GameDesignState.State,
    Partial<typeof GameDesignState.State>
  >
> {
  const saver = await getSaver(conversationId, graphType);
  return await _createDesignGraph(saver);
}

async function _createDesignGraph(saver: BaseCheckpointSaver) {
  const conversationNode = await _createDesignConversationNode(
    "",
    getConstraintsRegistry()
  );
  const specificationNode = await _createDesignSpecificationNode();

  const workflow = new StateGraph(GameDesignState);

  workflow.addNode("conversation", conversationNode);
  workflow.addNode("specification", specificationNode);

  workflow.addEdge(START, "conversation" as any);

  workflow.addConditionalEdges("conversation" as any, (state) => {
    if (
      state.specRequested &&
      (!state.currentGameSpec ||
        state.currentGameSpec.designSpecification.length == 0)
    ) {
      return "specification";
    }
    return END;
  });

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
  let updatedSpec: GameDesignSpecification | undefined = undefined;

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
      if (currentGameSpec && currentGameSpec.designSpecification.length > 0) {
        updatedSpec = currentGameSpec;
      } else {
        aiResponse = "No spec received.";
      }
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
    specification: updatedSpec,
    updatedTitle: lastTitle,
    systemPromptVersion: lastPromptVersion,
  };
}

function _extractGameTitle(content: string): string {
  const titleMatch = content.match(gameTitleRegex);
  return titleMatch ? titleMatch[1].trim() : "";
}

function _extractDesignSpecification(content: string): string {
  const specMatch = content.match(gameSpecificationRegex);
  return specMatch ? specMatch[1].trim() : "";
}

function _extractGameSummary(content: string): string | undefined {
  const summaryMatch = content.match(gameSummaryRegex);
  return summaryMatch ? summaryMatch[1].trim() : undefined;
}

function _extractPlayerCount(content: string): PlayerCount | undefined {
  const playerCountMatch = content.match(gamePlayerCountRegex);

  if (playerCountMatch) {
    const playerCountStr = playerCountMatch[1].trim();
    const parts = playerCountStr.split(":");

    if (parts.length === 2) {
      const min = parseInt(parts[0], 10);
      const max = parseInt(parts[1], 10);

      if (!isNaN(min) && !isNaN(max)) {
        return { min, max };
      }
    }
  }

  return undefined;
}
