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
  AttachmentBuilder
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

const designChannelId = process.env.CHAINCRAFT_DESIGN_CHANNEL_ID;
const designShareChannelId = process.env.CHAINCRAFT_DESIGN_SHARE_CHANNEL_ID;

const shareButton = new ButtonBuilder()
  .setCustomId("chaincraft_share_design")
  .setLabel("Share")
  .setStyle(ButtonStyle.Secondary);

const generateTokenButton = new ButtonBuilder()
  .setCustomId("chaincraft_upload_design")
  .setLabel("Generate Token")
  .setStyle(ButtonStyle.Secondary);

const buttonActionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
  shareButton,
  generateTokenButton
);

// Add error types
type OperationType = "start" | "continue" | "share" | "upload";
type ErrorContext = {
  operation: OperationType;
  threadId?: string;
  userId?: string;
  error: Error;
};

export async function isMessageInChaincraftDesignActiveThread(
  message: Message
) {  
  // Check if the message is sent in a thread
  if (!message.channel.isThread()) {
    return false;
  }

  // Ensure the thread is within the specific design channel
  if (message.channel.parentId !== designChannelId) {
    return false;
  }

  return await isActiveConversation(message.channelId);
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
    _updateThread(`${threadMessageText}\n\n${designResponse}`, thread, updatedTitle);

    // Send confirmation message with thread link
    thread = thread as ThreadChannel<boolean>;
    await thread.join();

    interaction.editReply(
      `${threadMessageText}. Thread created for your game design. [Click here to jump to the thread.](<${thread.url}>)")`
    );
  } catch (e) {
    await _handleChaincraftDesignError( interaction, e as Error, {
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
    await _handleChaincraftDesignError(message.channel as ThreadChannel, e as Error, {
      operation: "continue",
    });
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
  // Defer the response to avoid leaving the interaction hanging
  if (!interaction.deferred) {
    await interaction.deferReply();
  }
  // Add a pinned message to the thread with a link to the post
  const messageContent = `Shared in ${post.url}`;
  const pinnedMessages = await designThread.messages.fetchPinned();
  const existingPostMessage = pinnedMessages.find(
    (m) => m.content.includes("Shared in") && m.author.bot
  );

  if (existingPostMessage) {
    // If an existing pinned message is found, edit it
    await existingPostMessage.edit(messageContent);
    // No need to pin again if it's already pinned
  } else {
    // If no existing message is found, create a new one and pin it
    const sentMessage = await designThread.send(messageContent);
    await sentMessage.pin();
  }

  // Ensure the interaction is replied to, to avoid leaving the interaction hanging
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
    const attachment = new AttachmentBuilder(Buffer.from(imageBuffer))
      .setName('game-art.png');

    // Update the original message with the attachment
    await message.edit({
      content: content ?? "🎨 Game Art",
      files: [attachment]
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
    console.debug('[chaincraft-design] Total messages in thread:', messageCount);

    // Fetch all messages in the thread
    const messages = await thread.messages.fetch({ limit: messageCount });
    const firstMessage = messages.last();
    console.debug('[chaincraft-design] First message in thread:', firstMessage);

    const attachment = firstMessage!.attachments.first();
    console.debug('[chaincraft-design] Attachment:', attachment);
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
  console.debug('[ChainCraft Discord] In handleChaincraftDesignError Error message: %s', errorMessage);

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
