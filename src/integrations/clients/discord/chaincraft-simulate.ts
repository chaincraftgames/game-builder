import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonComponent,
  ButtonInteraction,
  ButtonStyle,
  Interaction,
  Message,
  MessageFlags,
  ModalSubmitInteraction,
  ThreadChannel,
  User,
} from "discord.js";
import {
  createSimulation,
  initializeSimulation as initSimState,
  processAction,
} from "#chaincraft/ai/simulate/simulate-workflow.js";
import { getLinkedThread } from "#chaincraft/integrations/clients/discord/thread-link.js";
import {
  createInitialPlayerStatus,
  getStatus,
  updateStatus,
  PlayerStatusType,
  mapPlayerStatesToStatus,
  SimStatus,
} from "#chaincraft/integrations/clients/discord/status-manager.js";
import {
  ActionHandler,
  clearActionHandlers,
  createActionHandler,
  getActionHandler,
} from "#chaincraft/integrations/clients/discord/action-handler.js";
import { get } from "http";

const resetSimId = "chaincraft_reset_simulation";
const returnToDesignId = "chaincraft_return_to_design";
const startGameId = "chaincraft_sim_start_game";
const assumeRoleIdPrefix = "chaincraft_sim_assume_role_player";
const playerActionIdPrefix = "chaincraft_sim_action_player";

const resetSimButton = new ButtonBuilder()
  .setCustomId(resetSimId)
  .setLabel("Reset Simulation")
  .setStyle(ButtonStyle.Secondary);

const returnToDesignButton = new ButtonBuilder()
  .setCustomId(returnToDesignId)
  .setLabel("Return to Design")
  .setStyle(ButtonStyle.Secondary);

// Add these at the top with other button definitions
const startGameButton = new ButtonBuilder()
  .setCustomId(startGameId)
  .setLabel("Start Game")
  .setStyle(ButtonStyle.Success)
  .setDisabled(true);

export interface GameConfiguration {
  maxPlayers: number;
  setupInstructions: string;
}

export async function initializeSimulation(
  simThread: ThreadChannel,
  creatingUser: User,
  gameSpec: string
): Promise<void> {
  const { playerCount, gameRules } = await createSimulation(
    simThread.id,
    gameSpec,
    1
  );

  // Tag the user who started the simulation
  const userTag = creatingUser.toString();
  simThread.send(
    `${userTag} has started a simulation with ${playerCount.maxPlayers} players.`
  );

  // Create player selection buttons
  const playerButtons = Array.from({ length: playerCount.maxPlayers }, (_, i) =>
    new ButtonBuilder()
      .setCustomId(`${assumeRoleIdPrefix}_${i + 1}`)
      .setLabel(`Play as Player ${i + 1}`)
      .setStyle(ButtonStyle.Primary)
  );

  const content = `
This game supports ${playerCount.maxPlayers} players. Select which player(s) 
you would like to control by clicking the corresponding buttons below.
    
The game rules are as follows: 
${gameRules} 
  `;

  // Send initial setup message
  await simThread.send({
    content,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(...playerButtons),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        startGameButton,
        resetSimButton,
        returnToDesignButton
      ),
    ],
  });

  // Initialize status with unassigned players
  await updateStatus(
    simThread,
    SimStatus.WAITING_FOR_PLAYERS,
    createInitialPlayerStatus(playerCount.maxPlayers)
  );
}

export async function continueSimulation(
  simThread: ThreadChannel,
  gameSpec: string
): Promise<void> {}

export async function resetSimulation(interaction: ButtonInteraction) {
  console.debug("[chaincraft-simulate] resetSimulation");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  clearActionHandlers(interaction.channelId!);
  // Get setup and status messages
  const setupMessage = await getSetupMessage(
    interaction.channel as ThreadChannel
  );
  if (!setupMessage) {
    console.error(
      "[chaincraft-simulate] resetSimulation: setup message not found. interaction:",
      interaction
    );
    await interaction.editReply({
      content: "Cannot reset simulation until game is initialized",
    });
    return;
  }

  const status = await updateStatus(interaction.channel as ThreadChannel);
  if (!status) {
    await interaction.editReply({
      content: "Sim must be initialized before it can be reset",
    });
    return;
  }

  // Enable all player selection buttons
  const newComponents = setupMessage.components.map((row) => {
    const newRow = new ActionRowBuilder<ButtonBuilder>();
    row.components.forEach((component) => {
      if (component instanceof ButtonComponent) {
        const updatedComponent = new ButtonBuilder()
          .setCustomId(component.customId!)
          .setLabel(component.label!)
          .setStyle(component.style)
          .setDisabled(component.customId === startGameId);
        newRow.addComponents(updatedComponent);
      }
    });
    return newRow;
  });

  await setupMessage.edit({
    content: setupMessage.content,
    components: newComponents,
  });

  // Delete all player messages
  console.debug(
    "[chaincraft-simulate] resetSimulation: deleting player messages"
  );
  const messages = (await interaction.channel?.messages.fetch()) ?? [];
  for (const [, message] of messages) {
    if (
      message.author.bot &&
      message.id !== status.message.id &&
      message.id !== setupMessage.id
    ) {
      await message.delete();
    }
  }

  await interaction.editReply({
    content:
      "Simulation has been reset. Note you will need to manually clear any ephemeral messages."
  });
}

export async function assumePlayerRole(interaction: ButtonInteraction) {
  console.debug("[chaincraft-simulate] assumePlayerRole");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const setupMessage = interaction.message;
  const match = interaction.customId.match(
    new RegExp(`${assumeRoleIdPrefix}_(\\d+)`)
  );
  if (!match) return;
  const playerNumber = parseInt(match[1]);

  createActionHandler(
    interaction.channelId!,
    `player${playerNumber}`,
    (playerId: string, action: string) =>
      processPlayerAction(playerId, interaction, action)
  );

  // Get status message to check all players are selected
  const status = await getStatus(interaction.channel as ThreadChannel);
  if (!status) {
    console.error(
      "[chaincraft-simulate] assumePlayerRole: status message not found. interaction:",
      interaction
    );
    await interaction.editReply({
      content: "Cannot select player role until game is initialized",
    });
    return;
  }

  const updatedPlayerStatus = status.playerStatus.slice();
  updatedPlayerStatus[playerNumber - 1] = PlayerStatusType.ASSIGNED;
  const allReady = updatedPlayerStatus.every(
    (status) => status === PlayerStatusType.ASSIGNED
  );

  // Update status message
  await updateStatus(
    interaction.channel as ThreadChannel,
    allReady ? SimStatus.READY_TO_START : SimStatus.WAITING_FOR_PLAYERS,
    updatedPlayerStatus
  );

  // Update button states
  const newComponents = setupMessage.components.map((row) => {
    const newRow = new ActionRowBuilder<ButtonBuilder>();
    row.components.forEach((component) => {
      if (component instanceof ButtonComponent) {
        const disabled = component.customId?.startsWith(assumeRoleIdPrefix) // Player selection buttons
          ? component.disabled || // Already selected
            component.customId === interaction.customId // Newly selected
          : component.customId === startGameId && !allReady;
        !component.disabled || // Already enabled
          component.customId === interaction.customId ||
          (component.customId === startGameId && allReady);
        const updatedComponent = new ButtonBuilder()
          .setCustomId(component.customId!)
          .setLabel(component.label!)
          .setStyle(component.style)
          .setDisabled(disabled);
        newRow.addComponents(updatedComponent);
      }
    });
    return newRow;
  });

  await setupMessage.edit({ components: newComponents });

  // Send ephemeral message to user with action button
  await interaction.editReply({
    content: `You have assumed the role of Player ${playerNumber}. Use the button below to take actions in the game.`,
    components: createActionComponents(playerNumber),
  });
}

export async function startGame(interaction: ButtonInteraction) {
  console.debug("[chaincraft-simulate] startGame");
  await interaction.deferUpdate();
  const status = await getStatus(interaction.channel as ThreadChannel);
  if (!(status?.status === SimStatus.READY_TO_START)) {
    await interaction.reply({
      content:
        "Cannot start game until game is initialized and all players are selected",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const thread = interaction.channel as ThreadChannel;

  // Initialize game state
  const players = [];
  for (let i = 0; i < status.playerStatus.length; i++) {
    if (status.playerStatus[i] !== PlayerStatusType.UNASSIGNED) {
      players.push(`player${i + 1}`);
    }
  }
  const { publicMessage, playerStates } = await initSimState(
    thread.id,
    players
  );

  // Update status with game state
  await updateStatus(
    thread,
    SimStatus.RUNNING,
    mapPlayerStatesToStatus(playerStates),
    publicMessage
  );

  // await interaction.update({});
}

export async function handlePlayerAction(interaction: ButtonInteraction) {
  console.debug("[chaincraft-simulate] handlePlayerAction");
  const match = interaction.customId.match(
    new RegExp(`${playerActionIdPrefix}_(\\d+)`)
  );
  if (!match) return;

  const playerNumber = parseInt(match[1]);

  // Make sure the game is started
  const status = await getStatus(interaction.channel as ThreadChannel);
  if (!status || status.status !== SimStatus.RUNNING) {
    await interaction.reply({
      content: "Please start the game before taking actions.",
      flags: MessageFlags.Ephemeral,
    })
    return;
  }

  if (status.playerStatus[playerNumber - 1] === PlayerStatusType.NO_ACTION_REQUIRED) {
    await interaction.reply({
      content: "No action is required for your player at this time.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  } 

  const playerId = `player${playerNumber}`;
  const thread = interaction.channel as ThreadChannel;

  // Get or create action handler for this thread
  let actionHandler = getActionHandler(
    thread.id,
    playerId
  );

  await actionHandler!.showActionModal(interaction, playerId);
}

export async function processPlayerAction(
  playerId: string,
  // interaction: ModalSubmitInteraction,
  interaction: ButtonInteraction,
  action: string
) {
  console.debug(
    "[chaincraft-simulate] processPlayerAction - playerId %s, action %s",
    playerId,
    action
  );
  const thread = interaction.channel as ThreadChannel;
  // Reply to the message with an initial response
  await interaction.editReply({
    content: `${getPlayerTag(playerId)} Processing your action...`,
    components: createActionComponents(parseInt(playerId.slice(-1)), true),
  });
  const { publicMessage, playerStates, gameEnded } = await processAction(
    interaction.channelId!,
    playerId,
    action
  );

  // Send player messages
  let playerMessage = playerStates.get(playerId)?.privateMessage;
  if (!playerMessage || playerMessage.length === 0) {
    playerMessage = "Action processed, but no message was returned.";
  }

  // Update status with game state
  await updateStatus(
    thread,
    gameEnded ? SimStatus.GAME_ENDED : SimStatus.RUNNING,
    mapPlayerStatesToStatus(playerStates, playerId),
    publicMessage
  );

  // Reply to the player who took the action
  await interaction.editReply({
    content: `${getPlayerTag(playerId)} ${playerMessage}`,
    components: createActionComponents(parseInt(playerId.slice(-1))),
  });
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

function createActionComponents(
  playerNumber: number,
  disabled: boolean = false
): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${playerActionIdPrefix}_${playerNumber}`)
        .setLabel("Take Action")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    ),
  ];
}

async function getSetupMessage(
  thread: ThreadChannel
): Promise<Message | undefined> {
  const messages = await thread.messages.fetch({ limit: 100 });
  for (const [, message] of messages) {
    if (
      message.components.length > 1 &&
      message.components.some((row) =>
        row.components.some(
          (component) =>
            component instanceof ButtonComponent &&
            component.customId === startGameId
        )
      )
    ) {
      return message;
    }
  }
  return undefined;
}

function getPlayerTag(playerId: string) {
  return `[Player ID: ${playerId}]`;
}
