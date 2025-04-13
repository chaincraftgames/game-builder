import fetch from "node-fetch";
import {
  ActionRowBuilder,
  APIEmbed,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  CommandInteraction,
  Message,
  TextChannel,
  ThreadChannel,
  AttachmentBuilder,
} from "discord.js";

import { chainCraftGameDescriptionOptionName } from "#chaincraft/integrations/clients/discord/commands/chaincraft-commands.js";
import {
  createThreadInChannel,
  sendToThread,
  createPost,
  pinataSDK,
} from "#chaincraft/integrations/clients/discord/util.js";
import {
  continueDesignConversation,
  DesignResponse,
  generateImage,
  getFullDesignSpecification,
  isActiveConversation,
} from "#chaincraft/ai/design/design-workflow.js";
import { OverloadedError } from "#chaincraft/ai/error.js";
import {
  getLinkedThread,
  storeThreadLink,
} from "#chaincraft/integrations/clients/discord/thread-link.js";
import {
  continueSimulation,
  initializeSimulation,
} from "#chaincraft/integrations/clients/discord/chaincraft-simulate.js";

const designChannelId = process.env.CHAINCRAFT_DESIGN_CHANNEL_ID;
const designShareChannelId = process.env.CHAINCRAFT_DESIGN_SHARE_CHANNEL_ID;
const simulationChannelId = process.env.CHAINCRAFT_SIMULATION_CHANNEL_ID;

const shareButton = new ButtonBuilder()
  .setCustomId("chaincraft_share_design")
  .setLabel("Share")
  .setStyle(ButtonStyle.Secondary);

const generateTokenButton = new ButtonBuilder()
  .setCustomId("chaincraft_upload_design")
  .setLabel("Generate Token")
  .setStyle(ButtonStyle.Secondary);

const simulateButton = new ButtonBuilder()
  .setCustomId("chaincraft_simulate_design")
  .setLabel("Simulate")
  .setStyle(ButtonStyle.Secondary);

const buttonActionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
  shareButton,
  generateTokenButton,
  simulateButton
);

// Add error types
type OperationType = "start" | "continue" | "share" | "upload";
type ErrorContext = {
  operation: OperationType;
  threadId?: string;
  userId?: string;
  error: Error;
};

export async function handleDesignMessage(
  message: Message
) {
  if (await isActiveConversation(message.channelId)) {
    continueChaincraftDesign(message);
  } 
}

// Start generation of a game design based on a given prompt
export async function startChaincraftDesign(interaction: CommandInteraction) {
  let thread: ThreadChannel | undefined;
  try {
    if (!(await _validateInteraction(interaction))) {
      return;
    }
    await interaction.deferReply();

    // The discord.js typings omit the functions on options for some reason, but the guide instructs us to use them
    // https://discordjs.guide/slash-commands/parsing-options.html#command-options
    const gameDescription = (interaction.options as any).getString(
      chainCraftGameDescriptionOptionName
    );

    // Create thread with loading state
    thread = await createThreadInChannel(
      interaction.client,
      designChannelId as string,
      `🔄 ${gameDescription!.substring(0, 90)}`, // Leave room for loading emoji
      true
    );

    if (!thread) throw new Error("Thread could not be created.");

    // Create initial image placeholder message
    const imageMessage = await thread.send({
      content: "🎨 Generating game art...",
    });

    // The initial message we send is ony used to get the thread ID.  The actual
    // message sent to the AI will be the gae description so the contents do not
    // matter in this case.
    const { updatedTitle, designResponse } = await _continueChaincraftDesign(
      imageMessage,
      gameDescription
    );

    console.log(
      `Game Title: ${updatedTitle}, Design Response: ${designResponse}`
    );

    // Kickoff the image generation as well
    _invokeGenerateImage(thread.id)
      .then((imageUrl) => {
        _updateMessageWithImage(imageMessage, imageUrl);
      })
      .catch((e) => {
        console.error(`Error generating image: ${e}`);
        imageMessage.edit({
          content: "❌ Failed to generate game art",
        });
      });

    const threadMessageText = `**${gameDescription}** - ${interaction.user.toString()}`;
    _updateThread(
      `${threadMessageText}\n\n${designResponse}`,
      thread,
      updatedTitle
    );

    // Send confirmation message with thread link
    thread = thread as ThreadChannel<boolean>;
    await thread.join();

    interaction.editReply(
      `${threadMessageText}. Thread created for your game design. [Click here to jump to the thread.](<${thread.url}>)")`
    );
  } catch (e) {
    await _handleChaincraftDesignError(interaction, e as Error, {
      operation: "start",
      threadToDelete: thread,
    });
  }
}

export async function continueChaincraftDesign(message: Message) {
  console.debug(
    "[chaincraft-gamebuilder-discord] In continueChaincraftDesign - message: %s",
    message.content
  );
  try {
    const { updatedTitle, designResponse } = await _continueChaincraftDesign(
      message
    );

    _updateThread(
      designResponse,
      message.channel as ThreadChannel<boolean>,
      updatedTitle
    );
  } catch (e) {
    await _handleChaincraftDesignError(
      message.channel as ThreadChannel,
      e as Error,
      {
        operation: "continue",
      }
    );
  }
}

export async function shareChaincraftDesign(interaction: ButtonInteraction) {
  try {
    if (
      !interaction.channel ||
      !(interaction.channel instanceof ThreadChannel)
    ) {
      await interaction.reply({
        content: "This interaction can only occur in a thread.",
        ephemeral: true,
      });
      return;
    }

    // Acknowledge the interaction immediately
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({
      content: "Share Design - 🔄 Retrieving the full design specification...",
    });

    const gameSpecification = await getFullDesignSpecification(
      interaction.channelId as string
    );

    await interaction.editReply({
      content: "Share Desgin - 📝 Processing design and preparing to share...",
    });

    const gameTitle = interaction.channel.name;
    const imageUrl = await _getImageUrlFromThread(interaction.channel);

    const postMessage = `**Game Title:** ${gameTitle}\n\n**Game Design Specification:** \n${gameSpecification}`;
    let imageEmbed: APIEmbed | undefined = imageUrl
      ? { image: { url: imageUrl } }
      : undefined;

    // Has the game design already been shared?
    const channel = interaction.channel as ThreadChannel;
    let postId = await _getStoredPostId(channel);
    let post;
    try {
      post = postId && (await interaction.client.channels.fetch(postId));
    } catch (error) {
      // Do nothing if the post is not found
    }
    if (!postId || !post) {
      const post = await createPost(
        interaction.client,
        designShareChannelId as string,
        gameTitle,
        postMessage,
        imageEmbed
      );
      _storePostId(interaction, channel, post);
      await interaction.editReply({
        content: "The game design has been shared.",
      });
    } else {
      // Fetch the post channel by ID
      sendToThread(post as ThreadChannel, gameSpecification);
      await interaction.editReply({
        content: "The game design has been updated.",
      });
    }
  } catch (error) {
    await _handleChaincraftDesignError(interaction, error as Error, {
      operation: "share",
    });
  }
}

export async function uploadChaincraftDesign(interaction: ButtonInteraction) {
  try {
    if (
      !interaction.channel ||
      !(interaction.channel instanceof ThreadChannel)
    ) {
      await interaction.reply({
        content: "This interaction can only occur in a thread.",
      });
      return;
    }
    const gameTitle = interaction.channel?.name;
    const name = `PAIT_${interaction.user.id}_${gameTitle.replace(/\s/g, "_")}`;

    // Acknowledge the interaction immediately
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({
      content:
        "Generate Token - 🔄 Retrieving the full design specification...",
    });

    const gameSpecification = await getFullDesignSpecification(
      interaction.channelId as string
    );

    await interaction.editReply({
      content: "Generate Token - 📤 Preparing to upload to IPFS...",
    });

    const state = {
      game_title: gameTitle,
      game_specification: gameSpecification,
      image_url: await _getImageUrlFromThread(interaction.channel),
    };

    await interaction.editReply({
      content: "Generate Token - ⏳ Uploading to IPFS...",
    });

    // Initialize Pinata client (adjust based on your SDK setup)
    const pinata = await pinataSDK();
    const upload = await pinata.upload.json(state).addMetadata({ name });
    //console.log(upload);

    await interaction.editReply({
      content: `✅ Design uploaded to IPFS!\nView at: https://ipfs.io/ipfs/${upload.IpfsHash}`,
    });
  } catch (error) {
    await _handleChaincraftDesignError(interaction, error as Error, {
      operation: "upload",
    });
  }
}

export async function simulateChaincraftDesign(interaction: ButtonInteraction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const designThread = interaction.channel as ThreadChannel;

    // Get full game specification
    await interaction.editReply({
      content: "📝 Getting game specification...",
    });

    const gameSpec = await getFullDesignSpecification(designThread.id);    

    // Check if simulation already exists
    const existingSimThread = await getLinkedThread(designThread, "simulation");
    if (existingSimThread) {
      await interaction.editReply({
        content: `Continuing existing simulation. [Click to join](<${existingSimThread.url}>)`,
      });
      continueSimulation(existingSimThread, gameSpec);
      return;
    }

    // Create simulation thread
    await interaction.editReply({
      content: "🎮 Creating simulation thread...",
    });

    const simThread = await createThreadInChannel(
      interaction.client,
      simulationChannelId as string,
      `🎲 ${designThread.name} Simulation`,
      true
    );

    if (!simThread) {
      throw new Error("Failed to create simulation thread");
    }

    // Store bidirectional links
    await storeThreadLink(designThread, simThread.id, "simulation");
    await storeThreadLink(simThread, designThread.id, "design");

    // Initialize simulation in the new thread
    await initializeSimulation(simThread, interaction.user, gameSpec, true);

    await simThread.join();
    await interaction.editReply({
      content: `Simulation created! [Click to join](<${simThread.url}>)`,
    });
  } catch (error) {
    console.error("Error handling simulate button:", error);
    await interaction.editReply({
      content:
        "There was an error setting up the simulation. Please try again.",
    });
  }
}

async function _getStoredPostId(thread: ThreadChannel) {
  // Get the pinned message from the thread
  const pinnedMessages = (await thread.messages.fetchPinned()).filter(
    (m: Message) => m.author.bot
  );

  // If there are no pinned messages, return
  if (pinnedMessages.size === 0) {
    return;
  }

  const postMessage = pinnedMessages.first();
  const match = postMessage?.content.match(
    /https:\/\/discord\.com\/channels\/\d+\/(\d+)(?:\/(\d+))?/
  );
  if (!match) {
    console.error(
      "Did not find a post link in the pinned message.",
      postMessage
    );
  }
  return match ? match[1] : undefined;
}

async function _storePostId(
  interaction: ButtonInteraction,
  designThread: ThreadChannel,
  post: ThreadChannel
) {
  await storeThreadLink(designThread, post.id, "shared");

  if (!interaction.replied) {
    await interaction.followUp({
      content: "The updated game design has been shared.",
      ephemeral: true,
    });
  }
}

async function _updateThread(
  designResponse: string,
  thread: ThreadChannel<boolean>,
  gameTitle?: string
) {
  try {
    const response = await sendToThread(thread, designResponse, {
      components: [buttonActionRow],
    });
    if (gameTitle && gameTitle.length > 0 && gameTitle !== thread.name) {
      await thread.setName(gameTitle);
    }
    return response;
  } catch (e) {
    console.error(`Error sending chunks: ${e}`);
  }
}

// Adds the image to the first message in the thread
async function _updateMessageWithImage(
  message: Message,
  imageUrl: string,
  content?: string
) {
  try {
    // Download image from URL
    const response = await fetch(imageUrl);
    const imageBuffer = await response.arrayBuffer();

    // Create Discord attachment
    const attachment = new AttachmentBuilder(Buffer.from(imageBuffer)).setName(
      "game-art.png"
    );

    // Update the original message with the attachment
    await message.edit({
      content: content ?? "🎨 Game Art",
      files: [attachment],
    });
  } catch (e) {
    console.error(`Error handling image: ${e}`);
    await message.edit({
      content: "❌ Failed to process game art",
    });
  }
}

async function _validateInteraction(
  interaction: CommandInteraction
): Promise<boolean> {
  if (interaction.guildId !== process.env.CHAINCRAFT_GUILD_ID) {
    await interaction.reply(
      "This command can only be used in the Chaincraft guild."
    );
    return false;
  }

  if (!interaction.channel || !(interaction.channel instanceof TextChannel)) {
    await interaction.reply("This command can only be used in a text channel.");
    return false;
  }
  return true;
}

async function _continueChaincraftDesign(
  message: Message,
  gameDescription?: string
): Promise<DesignResponse> {
  try {
    const threadId = message.channel.id;

    const processingMessage = await message.reply("Processing your request...");

    const response = await continueDesignConversation(
      threadId,
      message.content,
      gameDescription // We'd need to store this in the initial state
    );

    await processingMessage.delete();

    return response;
  } catch (e) {
    return Promise.reject(e);
  }
}

async function _invokeGenerateImage(conversationId: string): Promise<string> {
  try {
    const imageUrl = await generateImage(conversationId);
    return imageUrl;
  } catch (error) {
    throw new Error(`Error initializing chaincraft design agent: ${error}`);
  }
}

async function _getImageUrlFromThread(
  thread: ThreadChannel
): Promise<string | undefined> {
  // Get total message count from thread
  const messageCount = thread.messageCount;
  if (!messageCount) {
    console.error("No messages found in thread.");
    return;
  }
  console.debug("[chaincraft-design] Total messages in thread:", messageCount);

  // Fetch all messages in the thread
  const messages = await thread.messages.fetch({ limit: messageCount });
  const firstMessage = messages.last();
  console.debug("[chaincraft-design] First message in thread:", firstMessage);

  const attachment = firstMessage!.attachments.first();
  console.debug("[chaincraft-design] Attachment:", attachment);
  return attachment?.url;
}

async function _handleChaincraftDesignError(
  target: Message | CommandInteraction | ButtonInteraction | ThreadChannel,
  error: Error,
  context: {
    operation: OperationType;
    threadToDelete?: ThreadChannel;
  }
) {
  // Log error with context
  console.error(`Error in Chaincraft ${context.operation}:`, {
    error,
    threadId:
      context.threadToDelete?.id ??
      (target instanceof ThreadChannel ? target.id : undefined),
    userId: "user" in target ? target.user?.id : undefined,
  });

  // Determine error message
  const errorMessage = _getErrorMessage(error);
  console.debug(
    "[ChainCraft Discord] In handleChaincraftDesignError Error message: %s",
    errorMessage
  );

  try {
    // Handle thread cleanup first if needed
    if (context.threadToDelete) {
      try {
        // Verify thread still exists by trying to fetch it
        await context.threadToDelete.fetch();
        await context.threadToDelete.send(errorMessage);
        await context.threadToDelete.delete();
      } catch (threadError) {
        // Thread likely doesn't exist anymore, ignore the error
        console.debug("Thread already deleted or not accessible:", threadError);
      }
    }

    // Handle response based on target type
    if (target instanceof ThreadChannel) {
      await target.send(errorMessage);
    } else if (target instanceof CommandInteraction) {
      if (target.deferred) {
        await target.editReply(errorMessage);
      } else {
        await target.reply({ content: errorMessage, ephemeral: true });
      }
    } else if (target instanceof ButtonInteraction) {
      if (target.deferred) {
        await target.editReply(errorMessage);
      } else {
        await target.reply({ content: errorMessage, ephemeral: true });
      }
    } else {
      await target.reply(errorMessage);
    }
  } catch (secondaryError) {
    // Log if error handling itself fails
    console.error("Error while handling error:", secondaryError);
  }
}

function _getErrorMessage(error: Error): string {
  if (error instanceof OverloadedError) {
    return "Sorry, Chaincraft is overloaded right now. Please try again later.";
  }
  if (error.message.includes("permissions")) {
    return "Sorry, I don't have permission to perform that action.";
  }
  if (error.message.includes("rate limit")) {
    return "You're doing that too quickly. Please wait a moment and try again.";
  }
  return "Sorry, there was an error processing your request. Please try again later.";
}
