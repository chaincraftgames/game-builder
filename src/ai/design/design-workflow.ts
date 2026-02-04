import "dotenv/config.js";

import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { Checkpoint, CompiledStateGraph } from "@langchain/langgraph";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { createDesignGraphConfig } from "#chaincraft/ai/graph-config.js";
import {
  GameDesignSpecification,
  GameDesignState,
  SpecPlan,
} from "#chaincraft/ai/design/game-design-state.js";
import {
  gameTitleTag,
  imageDesignPrompt,
  produceFullGameDesignPrompt,
  imageGenPrompt,
  rawImageGenPrompt,
  rawImageNegativePrompt,
} from "#chaincraft/ai/design/game-design-prompts.js";
import { getSaver } from "#chaincraft/ai/memory/checkpoint-memory.js";
import { OverloadedError } from "#chaincraft/ai/error.js";
import {
  isActiveConversation as _isActiveConversation,
  registerConversationId,
} from "#chaincraft/ai/conversation.js";
import { imageGenTool, rawImageGenTool } from "#chaincraft/ai/tools.js";
import { GraphCache } from "#chaincraft/ai/graph-cache.js";
import { getConfig } from "#chaincraft/config.js";
import { getConstraintsRegistry } from "./design-data.js";
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
  "CHAINCRAFT_DESIGN_MODEL_NAME",
  process.env.CHAINCRAFT_DESIGN_MODEL_NAME
);

const graphType = getConfig("design-graph-type");

const designGraphCache = new GraphCache(
  createDesignGraph,
  parseInt(process.env.CHAINCRAFT_DESIGN_GRAPH_CACHE_SIZE ?? "100")
);

const imageGenSystemMessage =
  SystemMessagePromptTemplate.fromTemplate(imageGenPrompt);

const rawImageGenSystemMessage =
  SystemMessagePromptTemplate.fromTemplate(rawImageGenPrompt);

const gameTitleRegex = new RegExp(
  `.*?${gameTitleTag}(.*?)${gameTitleTag.replace("<", "</")}`,
  "s"
);

/** The state of the game design conversation. */
export interface DesignState {
  updatedTitle?: string;
  title: string;
  specification?: GameDesignSpecification
  specNarratives?: Record<string, string>;
  pendingSpecChanges?: string[];
  consolidationThreshold?: number;
  consolidationCharLimit?: number;
};

/** A response from the design workflow. */
export interface DesignResponse extends DesignState {
  designResponse: string;
  systemPromptVersion?: string;
  specDiff?: string;
}

export async function continueDesignConversation(
  conversationId: string,
  userMessage: string,
  gameDescription?: string,
  forceSpecGeneration?: boolean
): Promise<DesignResponse> {
  // Save the conversation id
  registerConversationId(graphType, conversationId);

  const graph = await designGraphCache.getGraph(conversationId);
  const config = createDesignGraphConfig(conversationId);

  // Format initial game description with XML tags if provided
  const message = gameDescription
    ? `
  <game_description>
    ${gameDescription}
  </game_description>`
    : userMessage;

  return _processMessage(graph, message, config, forceSpecGeneration);
}

export async function generateImage(
  conversationId: string,
  imageType: "legacy" | "raw" = "legacy"
): Promise<string> {
  // Retrieve cached specification to avoid regenerating it
  // Image generation is triggered after conversation continues, so the spec should already exist
  const specAndTitle = await getCachedDesign(conversationId);

  if (!specAndTitle || !specAndTitle.specification) {
    throw new Error(
      "Failed to generate image: no game design spec found. Spec should be generated before image generation."
    );
  }

  const { specification: { summary }, title } = specAndTitle;

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
        workflow: "design",
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
    throw new Error("Failed to generate image description: no content");
  }

  // Step 2: Choose the appropriate prompt and tool based on image type
  if (imageType === "raw") {
    // Use raw image generation
    const rawImagePrompt = await rawImageGenSystemMessage.format({
      image_description: imageDesign.content.toString().substring(0, 600),
      game_title: title,
    });

    const imageUrl = await rawImageGenTool
      .invoke(rawImagePrompt.content, {
        callbacks: modelWithOptions.getCallbacks(),
        metadata: {
          agent: "raw-image-generator",
          workflow: "design",
        },
        negativePrompt: rawImageNegativePrompt,
      })
      .catch((error) => {
        if (error.type && error.type == "overloaded_error") {
          throw new OverloadedError(error.message);
        } else {
          throw error;
        }
      });
    if (!imageUrl) {
      throw new Error("Failed to generate raw image: no image URL");
    }
    return imageUrl;
  } else {
    // Use legacy cartridge image generation
    const imageGenPrompt = await imageGenSystemMessage.format({
      image_description: imageDesign.content.toString().substring(0, 600),
      game_title: title,
    });
    const imageUrl = await imageGenTool
      .invoke(imageGenPrompt.content, {
        callbacks: modelWithOptions.getCallbacks(),
        metadata: {
          agent: "cartridge-image-generator",
          workflow: "design",
        },
      })
      .catch((error) => {
        if (error.type && error.type == "overloaded_error") {
          throw new OverloadedError(error.message);
        } else {
          throw error;
        }
      });
    if (!imageUrl) {
      throw new Error("Failed to generate legacy image: no image URL");
    }
    return imageUrl;
  }
}



// Read-only version that gets cached design state without creating checkpoints
export async function getCachedDesign(
  conversationId: string
): Promise<DesignState | undefined> {
  // Check if conversation exists
  if (!(await isActiveConversation(conversationId))) {
    throw new Error(`Conversation ${conversationId} not found`);
  }

  // Get the saver directly to access checkpoints
  const saver = await getSaver(conversationId, graphType);
  const config = createDesignGraphConfig(conversationId);

  console.log(
    "[getCachedDesign] Getting latest checkpoint for conversation:",
    conversationId
  );

  // Get only the first (latest) checkpoint
  const checkpointIterator = saver.list(config, { limit: 1 });
  const firstCheckpoint = await checkpointIterator.next();

  if (firstCheckpoint.done) {
    console.log("[getCachedDesign] No checkpoints found");
    return undefined;
  }

  const latestCheckpoint = firstCheckpoint.value;

  if (!latestCheckpoint.checkpoint.channel_values) {
    console.log(
      "[getCachedDesignSpecification] No channel_values in checkpoint"
    );
    return undefined;
  }

  return getDesignFromCheckpoint(latestCheckpoint.checkpoint);
}

/**
 * Retrieves a specific version of the design specification from checkpoint history.
 * Iterates through checkpoints to find the one with the matching version number.
 * 
 * @param conversationId - The conversation/game ID
 * @param version - The specific version number to retrieve
 * @returns The specification with matching version, or undefined if not found
 */
export async function getDesignByVersion(
  conversationId: string,
  version: number
): Promise<(DesignState | undefined)> {
  // Check if conversation exists
  if (!(await isActiveConversation(conversationId))) {
    throw new Error(`Conversation ${conversationId} not found`);
  }
  // Check if conversation exists
  if (!(await isActiveConversation(conversationId))) {
    throw new Error(`Conversation ${conversationId} not found`);
  }

  // Get the saver directly to access checkpoints
  const saver = await getSaver(conversationId, graphType);
  const config = createDesignGraphConfig(conversationId);

  console.log(
    "[getDesignSpecificationByVersion] Searching for version",
    version,
    "in conversation:",
    conversationId
  );

  // Iterate through checkpoints to find the matching version
  for await (const checkpoint of saver.list(config)) {
    if (!checkpoint.checkpoint.channel_values) {
      continue;
    }

    const channelValues = checkpoint.checkpoint.channel_values as any;
    const currentGameSpec = channelValues.currentSpec;
    const title = channelValues.title;

    if (currentGameSpec?.version === version) {
      console.log(
        "[getDesignSpecificationByVersion] Found spec version",
        version,
        "with title:",
        title || "no title"
      );

      return getDesignFromCheckpoint(checkpoint.checkpoint);
    }
  }

  // Version not found
  console.log(
    "[getDesignSpecificationByVersion] Version",
    version,
    "not found in conversation",
    conversationId
  );
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
  const config = createDesignGraphConfig(conversationId);

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

      // Keep everything else - let frontend handle display
      // This includes spec response messages and XML-only messages
      // as they may contain important metadata for parsing
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

async function getDesignFromCheckpoint(
  checkpoint: Checkpoint
): Promise<DesignState | undefined> {
  // Extract state from the checkpoint
  const channelValues = checkpoint.channel_values as any;
  const currentGameSpec = channelValues.currentSpec;
  const title = channelValues.title;
  const specNarratives = channelValues.specNarratives as Record<string, string> | undefined;
  const pendingSpecChanges = channelValues.pendingSpecChanges as SpecPlan[] | undefined;
  const consolidationThreshold = channelValues.consolidationThreshold as number | undefined;
  const consolidationCharLimit = channelValues.consolidationCharLimit as number | undefined;

  console.log(
    "[getCachedDesignSpecification] Found cached spec:",
    currentGameSpec ? "yes" : "no",
    "title:",
    title || "no title",
    "pending changes:",
    pendingSpecChanges?.length || 0
  );

  // If we have a cached spec, return it with pending changes
  // if (currentGameSpec && currentGameSpec.designSpecification) {
    return {
      specification: currentGameSpec?.designSpecification ? currentGameSpec : undefined,
      title: title || "Untitled Game",
      specNarratives,
      // Convert SpecPlan[] to string[] (extract changes field)
      pendingSpecChanges: pendingSpecChanges && pendingSpecChanges.length > 0
        ? pendingSpecChanges.map(plan => plan.changes)
        : undefined,
      consolidationThreshold,
      consolidationCharLimit,
    };
  // }
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
  config: { configurable: { thread_id: string } },
  forceSpecGeneration?: boolean
): Promise<DesignResponse> {
  const inputs = { 
    messages: [new HumanMessage(content)], 
    forceSpecGeneration: forceSpecGeneration ?? false
  };
  let aiResponse = "";
  let lastTitle = "";
  let lastPromptVersion = "";
  let updatedSpec: GameDesignSpecification | undefined = undefined;
  let specDiffSummary: string | undefined = undefined;
  let responsePendingSpecChanges: SpecPlan[] = [];
  let responseConsolidationThreshold: number | undefined = undefined;
  let responseConsolidationCharLimit: number | undefined = undefined;
  let responseNarratives: Record<string, string> | undefined = undefined;

  for await (const {
    messages,
    title,
    systemPromptVersion,
    currentSpec,
    specDiff,
    pendingSpecChanges,
    consolidationThreshold,
    consolidationCharLimit,
    specNarratives,
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
    if (currentSpec && currentSpec.designSpecification) {
      updatedSpec = currentSpec;
    }

    // Capture the spec diff summary if present
    if (specDiff) {
      specDiffSummary = specDiff;
    }

    if (title) {
      lastTitle = title;
    }

    if (pendingSpecChanges) {
      responsePendingSpecChanges = pendingSpecChanges;
    }

    if (consolidationThreshold !== undefined) {
      responseConsolidationThreshold = consolidationThreshold;
    }
    
    if (consolidationCharLimit !== undefined) {
      responseConsolidationCharLimit = consolidationCharLimit;
    }

    if (specNarratives) {
      responseNarratives = specNarratives;
    }

    lastPromptVersion = systemPromptVersion;
  }

  const hasPendingSpecChanges = responsePendingSpecChanges.length > 0;

  return {
    designResponse: aiResponse.length > 0 ? aiResponse : "No response",
    specification: updatedSpec,
    specNarratives: responseNarratives,
    updatedTitle: lastTitle,
    title: lastTitle,
    systemPromptVersion: lastPromptVersion,
    specDiff: specDiffSummary,

    // Extract just the "changes" field from each SpecPlan
    pendingSpecChanges: hasPendingSpecChanges 
      ? responsePendingSpecChanges.map(plan => plan.changes)
      : undefined,
    consolidationThreshold: hasPendingSpecChanges 
      ? responseConsolidationThreshold 
      : undefined,
    consolidationCharLimit: hasPendingSpecChanges 
      ? responseConsolidationCharLimit 
      : undefined,
  };
}
