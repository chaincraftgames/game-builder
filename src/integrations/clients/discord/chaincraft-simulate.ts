import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Interaction,
  Message,
  ThreadChannel,
} from "discord.js";
import { getLinkedThread } from "#chaincraft/integrations/clients/discord/thread-link.js";
import { createSimulation, initializeSimulation as initSimState, processAction } from "#chaincraft/ai/simulate/simulate-workflow.js";

const resetSimButton = new ButtonBuilder()
  .setCustomId("chaincraft_reset_sim")
  .setLabel("Reset Simulation")
  .setStyle(ButtonStyle.Secondary);

const returnToDesignButton = new ButtonBuilder()
  .setCustomId("chaincraft_return_to_design")
  .setLabel("Return to Design")
  .setStyle(ButtonStyle.Secondary);

export interface GameConfiguration {
  maxPlayers: number;
  setupInstructions: string;
}

export async function initializeSimulation(
  simThread: ThreadChannel,
  gameSpec: string
): Promise<void> {
  const { playerCount, gameRules } = await createSimulation(
    simThread.id,
    gameSpec,
    1
  );

  const content = `
This game supports ${playerCount.maxPlayers} players.  You will be playing 
the role of all players in this simulation.  When taking an action, please 
reply to the last message from the bot to the player taking the action.
    
The game rules are as follows: 
${gameRules} 
  `
  // Send initial setup message
  await simThread.send({
    content,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        resetSimButton,
        returnToDesignButton
      ),
    ],
  });

  const players = Array.from({ length: playerCount.maxPlayers }, (_, i) => `player${i + 1}`);

  // Initialize the game state
  const playerMessages = await initSimState(simThread.id, players);
 
  // Send player messages
  for (const [playerId, message] of playerMessages) {
    messagePlayer(simThread, playerId, message);
  }
}

export async function continueSimulation(
  simThread: ThreadChannel,
  gameSpec: string
): Promise<void> {}

export async function handleSimulationMessage(message: Message) {
  const simThread = message.channel as ThreadChannel;
  // Get the replied-to message
  const repliedTo = message.reference?.messageId;
  if (repliedTo) {
    // Get the player ID from the replied-to message
    const repliedToMessage = await simThread.messages.fetch(repliedTo);
    const playerId = repliedToMessage.content.match(/\[Player ID: (\w+)\]/)?.[1];
    if (playerId) {
      return await processPlayerAction(playerId, message);
    }
  }

  message.reply("Please reply to the last message from the bot to the player who is taking the action.");
}

async function processPlayerAction(playerId: string, message: Message) {
  // Reply to the message with an initial response
  const response = await message.reply("Processing your action...");
  const { playerMessages, gameEnded } = await processAction(
    message.channelId,
    playerId,
    message.content
  );
  const thread = message.channel as ThreadChannel;

  // Send player messages
  for (const [pid, playerMessage] of playerMessages) {
    if (pid === playerId) {
      // Reply to the player who took the action
      await response.edit(`${getPlayerTag(pid)} ${playerMessage}`);
    } else {
      // Send messages to other players
      messagePlayer(thread, pid, playerMessage);
    }
  }

  if (gameEnded) {
    await thread.send("The game has ended.  Please reset the simulation to play again.");
  }
}

async function getDesignThread(
  interaction: Interaction
): Promise<ThreadChannel | null> {
  if (!interaction.channel || !interaction.isButton()) {
    return null;
  }

  const buttonInteraction = interaction as ButtonInteraction;

  // If this is a new simulation, the design thread is the current channel
  if (buttonInteraction.customId === "chaincraft_simulate_design") {
    return interaction.channel as ThreadChannel;
  }

  // For existing simulations, get the design thread using the utility
  return await getLinkedThread(interaction.channel as ThreadChannel, "design");
}

async function messagePlayer(thread: ThreadChannel, playerId: string, content: string) {
  // Find the last message from the player
  const messages = await thread.messages.fetch();
  const recentPlayerMessage = messages.filter(message => 
    !message.author.bot && message.content.startsWith(getPlayerTag(playerId))
  )
  .first();
  if (!recentPlayerMessage) {
    // Send a new message
    await thread.send(`${getPlayerTag(playerId)} ${content}`);
  } else {
    // Reply to the last message
    recentPlayerMessage.reply(`${getPlayerTag(playerId)} ${content}`);
  }

}

function getPlayerTag(playerId: string) {
  return `[Player ID: ${playerId}]`;
}
