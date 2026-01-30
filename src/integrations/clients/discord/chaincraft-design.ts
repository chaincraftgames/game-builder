import fetch from "node-fetch";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
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
} from "#chaincraft/integrations/clients/discord/util.js";
import {
  continueDesignConversation,
  DesignResponse,
  DesignState,
  generateImage,
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
import {
  clearSpecification,
  getSpecificationForThread,
  setSpecificationForThread,
} from "#chaincraft/integrations/clients/discord/specification_manager.js";


const designChannelId = process.env.CHAINCRAFT_DESIGN_CHANNEL_ID;
const simulationChannelId = process.env.CHAINCRAFT_SIMULATION_CHANNEL_ID;

const publishGameButton = new ButtonBuilder()
  .setCustomId("chaincraft_publish_design")
  .setLabel("Publish Game")
  .setStyle(ButtonStyle.Primary);

const simulateButton = new ButtonBuilder()
  .setCustomId("chaincraft_simulate_design")
  .setLabel("Simulate Game")
  .setStyle(ButtonStyle.Primary);

const buttonActionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
  publishGameButton,
  simulateButton
);

// Add error types
type OperationType = "start" | "continue" | "publish" | "simulate";

export async function handleDesignMessage(
  message: Message
) {
  if (await isActiveConversation(message.channelId)) {
    continueChaincraftDesign(message);
  } 
}

// Start generation of a game design based on a given prompt
export async function startChaincraftDesign(interaction: ChatInputCommandInteraction) {
  let thread: ThreadChannel | undefined;
  try {
    if (!(await _validateInteraction(interaction))) {
      return;
    }
    await interaction.deferReply();

    // ChatInputCommandInteraction has the options property
    const gameDescription = interaction.options.getString(
      chainCraftGameDescriptionOptionName
    );

    if (!gameDescription) {
      await interaction.editReply("Game description is required.");
      return;
    }

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
    // message sent to the AI will be the game description so the contents do not
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
    const response = await _continueChaincraftDesign(
      message
    );

    if (response.specification) {
      console.debug('[chaincraft-design] Updated spec returned from design agent.')
      setSpecificationForThread(
        message.channel as ThreadChannel,
        response.specification,
      )
    } else {
      console.debug('[chaincraft-design] Design changed, invalidating spec.')
      clearSpecification(
        message.channel as ThreadChannel,
      )
    }

    _updateThread(
      response.designResponse,
      message.channel as ThreadChannel<boolean>,
      response.updatedTitle
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

export async function simulateChaincraftDesign(interaction: ButtonInteraction) {
  console.debug('[chaincraft-design] - Initializing simulation...');
  await interaction.deferReply({ ephemeral: true });

  try {
    const designThread = interaction.channel as ThreadChannel;

    // Get full game specification
    await interaction.editReply({
      content: "📝 Getting game specification...",
    });

    const specResult = await getSpecificationForThread(designThread);
    
    if (!specResult) {
      await interaction.editReply({
        content: "Failed to retrieve the game specification. Please try again later.",
      });
      return;
    }

    // Check if simulation already exists
    const existingSimThread = await getLinkedThread(designThread, "simulation");
    if (existingSimThread) {
      await interaction.editReply({
        content: `Continuing existing simulation. [Click to join](<${existingSimThread.url}>)`,
      });
      continueSimulation(existingSimThread, specResult.specification, specResult.version);
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

    // Initialize simulation in the new thread with specification version
    await initializeSimulation(
      simThread, 
      interaction.user, 
      specResult.specification, 
      specResult.version,
      true
    );

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
    // Create an AbortController with a timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 seconds
    
    try {
      // Download image from URL with abort signal
      const response = await fetch(imageUrl, {
        signal: controller.signal
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
      }
      
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
    } finally {
      clearTimeout(timeoutId); // Clean up the timeout
    }
  } catch (e: any) {
    console.error(`Error handling image: ${e}`);
    // More specific error message based on error type
    const errorMessage = e.name === 'AbortError' 
      ? "❌ Image download timed out. The image might be too large or the server is slow."
      : "❌ Failed to process game art";
      
    await message.edit({
      content: errorMessage,
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
