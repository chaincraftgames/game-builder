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
import {
  logApplicationEvent,
  logSecretStatus,
} from "#chaincraft/util/safe-logging.js";
import { createMainDesignGraph } from "./graphs/main-design-graph/index.js";
import { setupDesignModel } from "#chaincraft/ai/model-config.js";

// Log safe application startup info
logApplicationEvent("design-workflow", "initializing", {
  cacheSize: parseInt(process.env.CHAINCRAFT_DESIGN_GRAPH_CACHE_SIZE ?? "100"),
});

// Check that required secrets are available without logging their values
logSecretStatus(
  "CHAINCRAFT_GAME_DESIGN_MODEL_NAME",
  process.env.CHAINCRAFT_GAME_DESIGN_MODEL_NAME
);

const graphType = getConfig("design-graph-type");

const designGraphCache = new GraphCache(
  createDesignGraph,
  parseInt(process.env.CHAINCRAFT_DESIGN_GRAPH_CACHE_SIZE ?? "100")
);

const imageGenSystemMessage =
  SystemMessagePromptTemplate.fromTemplate(imageGenPrompt);

const gameTitleRegex = new RegExp(
  `.*?${gameTitleTag}(.*?)${gameTitleTag.replace("<", "</")}`,
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
    version: number;
  };
  specDiff?: string;
};

export async function continueDesignConversation(
  conversationId: string,
  userMessage: string,
  gameDescription?: string
): Promise<DesignResponse> {
  // Save the conversation id
  registerConversationId(graphType, conversationId);

  const graph = await designGraphCache.getGraph(conversationId);
  const config = { configurable: { thread_id: conversationId } };

  // Format initial game description with XML tags if provided
  const message = gameDescription
    ? `
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

  // Setup model with design defaults (includes tracer callbacks)
  const modelWithOptions = await setupDesignModel();

  const imageDesign = await modelWithOptions
    .invokeWithMessages(
      [
        new SystemMessage(imageDesignPrompt),
        new HumanMessage(
          `<game_design_specification>
        ${summary}
        </game_design_specification>`
        ),
      ],
      {
        agent: "image-design-generator",
        workflow: "design"
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
      callbacks: modelWithOptions.invokeOptions.callbacks,
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

// Read-only version that gets cached specification without creating checkpoints
export async function getCachedDesignSpecification(
  conversationId: string
): Promise<(GameDesignSpecification & { title: string }) | undefined> {
  // Check if conversation exists
  if (!(await isActiveConversation(conversationId))) {
    throw new Error(`Conversation ${conversationId} not found`);
  }

  // Get the saver directly to access checkpoints
  const saver = await getSaver(conversationId, graphType);
  const config = { configurable: { thread_id: conversationId } };

  console.log(
    "[getCachedDesignSpecification] Getting latest checkpoint for conversation:",
    conversationId
  );

  // Get only the first (latest) checkpoint
  const checkpointIterator = saver.list(config, { limit: 1 });
  const firstCheckpoint = await checkpointIterator.next();

  if (firstCheckpoint.done) {
    console.log("[getCachedDesignSpecification] No checkpoints found");
    return undefined;
  }

  const latestCheckpoint = firstCheckpoint.value;

  if (!latestCheckpoint.checkpoint.channel_values) {
    console.log(
      "[getCachedDesignSpecification] No channel_values in checkpoint"
    );
    return undefined;
  }

  // Extract state from the checkpoint
  const channelValues = latestCheckpoint.checkpoint.channel_values as any;
  const currentGameSpec = channelValues.currentGameSpec;
  const title = channelValues.title;

  console.log(
    "[getCachedDesignSpecification] Found cached spec:",
    currentGameSpec ? "yes" : "no",
    "title:",
    title || "no title"
  );

  // If we have a cached spec, return it
  if (currentGameSpec && currentGameSpec.designSpecification) {
    return {
      ...currentGameSpec,
      title: title || "Untitled Game",
    };
  }

  // No cached spec available
  console.log("[getCachedDesignSpecification] No cached specification found");
  return undefined;
}

// Function to generate a new specification (creates checkpoints)
export async function generateNewDesignSpecification(
  conversationId: string
): Promise<(GameDesignSpecification & { title: string }) | undefined> {
  console.log(
    "[generateNewDesignSpecification] Generating new specification for:",
    conversationId
  );
  return await getFullDesignSpecification(conversationId);
}

// Function to get cached title and basic info (doesn't create checkpoints)
export async function getCachedConversationMetadata(
  conversationId: string
): Promise<{ title: string } | undefined> {
  // Check if conversation exists
  if (!(await isActiveConversation(conversationId))) {
    throw new Error(`Conversation ${conversationId} not found`);
  }

  // Get the saver directly to access checkpoints
  const saver = await getSaver(conversationId, graphType);
  const config = { configurable: { thread_id: conversationId } };

  console.log(
    "[getCachedConversationMetadata] Getting latest checkpoint for conversation:",
    conversationId
  );

  // Get only the first (latest) checkpoint
  const checkpointIterator = saver.list(config, { limit: 1 });
  const firstCheckpoint = await checkpointIterator.next();

  if (firstCheckpoint.done) {
    console.log("[getCachedConversationMetadata] No checkpoints found");
    return undefined;
  }

  const latestCheckpoint = firstCheckpoint.value;

  if (!latestCheckpoint.checkpoint.channel_values) {
    console.log(
      "[getCachedConversationMetadata] No channel_values in checkpoint"
    );
    return undefined;
  }

  // Extract state from the checkpoint
  const channelValues = latestCheckpoint.checkpoint.channel_values as any;

  // First try to get title from the stored title field
  let title = channelValues.title;

  // If no stored title, try to extract from messages
  if (!title) {
    const rawMessages = channelValues.messages;
    if (rawMessages && Array.isArray(rawMessages)) {
      // Look through messages for AI responses that contain game titles
      for (const msg of rawMessages) {
        if (
          msg._type === "ai" ||
          msg.constructor?.name === "AIMessage" ||
          msg.type === "ai"
        ) {
          const content =
            typeof msg.content === "string"
              ? msg.content
              : msg.kwargs && msg.kwargs.content
              ? msg.kwargs.content
              : "";

          if (content) {
            const extractedTitle = _extractGameTitle(content);
            if (extractedTitle) {
              title = extractedTitle;
              break; // Use the first title found
            }
          }
        }
      }
    }
  }

  console.log(
    "[getCachedConversationMetadata] Found title:",
    title || "no title"
  );

  // Return title if available, otherwise return undefined
  if (title) {
    return { title };
  }

  // No title available
  console.log("[getCachedConversationMetadata] No title found");
  return undefined;
}

export async function getConversationHistory(
  conversationId: string,
  page: number = 1,
  limit: number = 50
): Promise<{
  conversationId: string;
  messages: Array<{
    type: "human" | "ai" | "system";
    content: string;
    timestamp?: string;
  }>;
  totalMessages: number;
  page: number;
  limit: number;
  hasMore: boolean;
}> {
  // Check if conversation exists
  if (!(await isActiveConversation(conversationId))) {
    throw new Error(`Conversation ${conversationId} not found`);
  }

  // Get the saver directly to access checkpoints
  const saver = await getSaver(conversationId, graphType);
  const config = { configurable: { thread_id: conversationId } };

  console.log(
    "[getConversationHistory] Getting latest checkpoint for conversation:",
    conversationId
  );

  // Get only the first (latest) checkpoint
  const checkpointIterator = saver.list(config, { limit: 1 });
  const firstCheckpoint = await checkpointIterator.next();

  if (firstCheckpoint.done) {
    return {
      conversationId,
      messages: [],
      totalMessages: 0,
      page,
      limit,
      hasMore: false,
    };
  }

  const latestCheckpoint = firstCheckpoint.value;

  if (!latestCheckpoint.checkpoint.channel_values) {
    console.log("[getConversationHistory] No channel_values in checkpoint");
    return {
      conversationId,
      messages: [],
      totalMessages: 0,
      page,
      limit,
      hasMore: false,
    };
  }

  // Extract messages from the checkpoint
  const channelValues = latestCheckpoint.checkpoint.channel_values as any;
  const rawMessages = channelValues.messages;

  console.log(
    "[getConversationHistory] Raw messages from checkpoint:",
    rawMessages
      ? Array.isArray(rawMessages)
        ? rawMessages.length
        : "not array"
      : "undefined"
  );

  // Ensure messages is an array
  if (!rawMessages || !Array.isArray(rawMessages)) {
    console.log("[getConversationHistory] No valid messages array found");
    return {
      conversationId,
      messages: [],
      totalMessages: 0,
      page,
      limit,
      hasMore: false,
    };
  }

  // Convert LangChain messages to our format
  const formattedMessages = rawMessages
    .map((msg: any) => {
      let type: "human" | "ai" | "system";

      // Check the message type based on the _type field or constructor
      if (
        msg._type === "human" ||
        msg.constructor?.name === "HumanMessage" ||
        msg.type === "human"
      ) {
        type = "human";
      } else if (
        msg._type === "ai" ||
        msg.constructor?.name === "AIMessage" ||
        msg.type === "ai"
      ) {
        type = "ai";
      } else if (
        msg._type === "system" ||
        msg.constructor?.name === "SystemMessage" ||
        msg.type === "system"
      ) {
        type = "system";
      } else {
        // Fallback: try to determine from content or default to ai
        type = "ai";
      }

      let content = "";
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (msg.content && typeof msg.content === "object") {
        content = JSON.stringify(msg.content);
      } else if (msg.kwargs && msg.kwargs.content) {
        content =
          typeof msg.kwargs.content === "string"
            ? msg.kwargs.content
            : JSON.stringify(msg.kwargs.content);
      }

      return {
        type,
        content,
        // Add timestamp if available
        timestamp: msg.timestamp || msg.created_at,
      };
    })
    .filter((msg: any) => {
      // Filter out empty messages
      if (!msg.content || msg.content.length === 0) return false;

      // Filter out system messages (these are internal prompts)
      if (msg.type === "system") return false;

      // Filter out automatic spec request messages (exact match)
      if (
        msg.type === "human" &&
        msg.content.trim() ===
          "Please provide the full detailed specification of the game design so far."
      ) {
        return false;
      }

      // Filter out spec response messages (they contain the XML tags)
      if (
        msg.type === "ai" &&
        msg.content.includes("<game_specification_requested>")
      ) {
        return false;
      }

      // Filter out messages that are ONLY XML tags (not content wrapped in XML)
      const trimmedContent = msg.content.trim();
      if (
        trimmedContent.startsWith("<") &&
        trimmedContent.endsWith(">") &&
        !trimmedContent.includes("\n") &&
        trimmedContent.length < 100
      ) {
        // Only filter very short XML-only messages
        return false;
      }

      return true;
    });

  console.log(
    "[getConversationHistory] Extracted messages after filtering:",
    formattedMessages.length
  );

  // Apply pagination
  const totalMessages = formattedMessages.length;
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  const paginatedMessages = formattedMessages.slice(startIndex, endIndex);
  const hasMore = endIndex < totalMessages;

  return {
    conversationId,
    messages: paginatedMessages,
    totalMessages,
    page,
    limit,
    hasMore,
  };
}

export async function isActiveConversation(
  conversationId: string
): Promise<boolean> {
  return _isActiveConversation(graphType, conversationId);
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
  return await createMainDesignGraph(saver, getConstraintsRegistry(), "");
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
  let specDiffSummary: string | undefined = undefined;

  for await (const {
    messages,
    title,
    systemPromptVersion,
    currentGameSpec,
    specDiff,
  } of await graph.stream(inputs, {
    ...config,
    streamMode: "values",
  })) {
    // Get the last message which should be the AI's response
    const msg = messages[messages?.length - 1];

    // Always process AI messages to capture the response content
    if (msg?.content && msg instanceof AIMessage) {
      aiResponse = msg.content.toString();
    }

    // Capture the final spec if it was updated
    if (currentGameSpec && currentGameSpec.designSpecification) {
      updatedSpec = currentGameSpec;
    }

    // Capture the spec diff summary if present
    if (specDiff) {
      specDiffSummary = specDiff;
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
    specDiff: specDiffSummary,
  };
}

function _extractGameTitle(content: string): string {
  const titleMatch = content.match(gameTitleRegex);
  return titleMatch ? titleMatch[1].trim() : "";
}
