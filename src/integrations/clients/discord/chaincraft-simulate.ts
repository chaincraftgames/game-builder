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
  getSimulationState,
  initializeSimulation as initSimState,
  processAction,
} from "#chaincraft/ai/simulate/simulate-workflow.js";
import { getLinkedThread } from "#chaincraft/integrations/clients/discord/thread-link.js";
import {
  initStatus,
  getStatus,
  updateStatus,
  SimStatus,
  updateFromSimResponse,
  getAssignedUser,
} from "#chaincraft/integrations/clients/discord/status-manager.js";
import {
  showActionModal,
  showQuestionModal,
} from "#chaincraft/integrations/clients/discord/modal-handler.js";
import { GameDesignSpecification } from "#chaincraft/ai/design/game-design-state.js";

const resetSimId = "chaincraft_reset_simulation";
const returnToDesignId = "chaincraft_return_to_design";
const startGameId = "chaincraft_sim_start_game";
const continueGameId = "chaincraft_sim_continue_game";
const assumeRoleIdPrefix = "chaincraft_sim_assume_role_player";
// This displays correctly in Discord, but not in the code editor.
const setupmMessageHeader = `
╔══════════╗
       MAIN MENU
╚══════════╝
`;

const resetSimButton = new ButtonBuilder()
  .setCustomId(resetSimId)
  .setStyle(ButtonStyle.Secondary);

// const returnToDesignButton = new ButtonBuilder()
//   .setCustomId(returnToDesignId)
//   .setLabel("Return to Design")
//   .setStyle(ButtonStyle.Secondary);

const startGameButton = new ButtonBuilder()
  .setCustomId(startGameId)
  .setLabel("Start Game")
  .setStyle(ButtonStyle.Success)
  .setDisabled(true);

const continueGameButton = new ButtonBuilder()
  .setCustomId(continueGameId)
  .setLabel("Continue Game")
  .setStyle(ButtonStyle.Success)
  .setDisabled(true);

const continueGameQuestion = `
  The players of the game believe they have completed all actions and are 
  waiting for the game to continue.  If waiting for a player action, please 
  inform the player(s) you are waiting on via public message.  If not waiting 
  on player actions, then you please take the appropriate game level actions to 
  continue the game, e.g. judging, scoring, generating narrative, resolving 
  non-player or ai controlled player actions.
`;

export interface GameConfiguration {
  maxPlayers: number;
  setupInstructions: string;
}

export async function initializeSimulation(
  simThread: ThreadChannel,
  creatingUser: User,
  gameSpec: GameDesignSpecification,
  specVersion: number,
  isPlayTest = false
): Promise<void> {
  const { gameRules } = await createSimulation(
    simThread.id,
    gameSpec.designSpecification,
    specVersion
  );

  // Tag the user who started the simulation
  const userTag = creatingUser.toString();
  const versionInfo = `(Specification v${specVersion})`;
  const { playerCount } = gameSpec;
  simThread.send(`
${setupmMessageHeader}
${userTag} has started a ${isPlayTest ? "simulation" : "game"} with ${
    playerCount.min
  } to ${playerCount.max} players. ${versionInfo}
`);

  // Limit player count to 5 players max due to discord button limitations.
  playerCount.max = Math.min(playerCount.max, 5);

  // Create player selection buttons
  const playerButtons = Array.from({ length: playerCount.max }, (_, i) =>
    new ButtonBuilder()
      .setCustomId(`${assumeRoleIdPrefix}_${i + 1}`)
      .setLabel(`Play as Player ${i + 1}`)
      .setStyle(ButtonStyle.Primary)
  );

  const content = `
This game supports ${playerCount.min} to ${playerCount.max} players. Select which player(s) 
you would like to control by clicking the corresponding buttons below.
    
The game rules are as follows: 
${gameRules} 
`;

  // Send initial setup message
  await simThread.send({
    content,
  });

  // Send message with buttons as a separate message to avoid the interaction
  // messages from having a summary of the game rules
  await simThread.send({
    content: "",
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(...playerButtons),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        startGameButton,
        resetSimButton.setLabel(
          isPlayTest ? "Reset Simulation" : "Restart Game"
        )
        // returnToDesignButton
      ),
    ],
  });

  // Initialize status with unassigned players
  await initStatus(simThread, Math.min(playerCount.max, 5));
}

export async function continueSimulation(
  simThread: ThreadChannel,
  gameSpec: GameDesignSpecification,
  gameSpecVersion: number
): Promise<void> {}

export async function resetSimulation(interaction: ButtonInteraction) {
  console.debug("[chaincraft-simulate] resetSimulation");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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

  const status = await initStatus(interaction.channel as ThreadChannel).catch(
    async (err) => {
      await interaction.editReply({
        content: "Sim must be initialized before it can be reset",
      });
      return;
    }
  );

  if (!status) {
    return;
  }

  await updateButtonEnabledStates(
    setupMessage,
    false,
    "start",
    Array.from({ length: status.playerCount }, () => true)
  );

  await interaction.editReply({
    content:
      "Simulation has been reset. Note you will need to manually clear any ephemeral messages.",
  });
}

export async function assumePlayerRole(interaction: ButtonInteraction) {
  console.debug("[chaincraft-simulate] assumePlayerRole");
  await interaction.deferUpdate();
  const setupMessage = interaction.message;
  const match = interaction.customId.match(
    new RegExp(`${assumeRoleIdPrefix}_(\\d+)`)
  );
  if (!match) return;
  const playerNumber = parseInt(match[1]);

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

  const updatedPlayerStatus = [...status.playerStatus];
  updatedPlayerStatus[playerNumber - 1].assignedUserId = interaction.user.id;
  const allReady = updatedPlayerStatus.every(
    (status) => status.assignedUserId !== undefined
  );

  const playerButtonsEnabled = updatedPlayerStatus.map(
    (status) => status.assignedUserId === undefined
  );

  // Update button states
  updateButtonEnabledStates(
    setupMessage,
    allReady,
    "start",
    playerButtonsEnabled
  );

  // Update status message
  await updateStatus(interaction.channel as ThreadChannel, {
    ...status,
    status: allReady ? SimStatus.READY_TO_START : SimStatus.WAITING_FOR_PLAYERS,
    playerStatus: updatedPlayerStatus,
  });
}

export async function handleStartOrContinueGame(
  interaction: ButtonInteraction
) {
  if (interaction.customId === startGameId) {
    await startGame(interaction);
  } else if (interaction.customId === continueGameId) {
    await continueGame(interaction);
  }
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

  // Indicate that the game is starting...
  updateStatus(interaction.channel as ThreadChannel, {
    ...status,
    status: SimStatus.STARTING,
  });

  updateButtonEnabledStates(
    interaction.message,
    false,
    "start",
    Array.from({ length: status.playerCount }, () => false)
  );

  const thread = interaction.channel as ThreadChannel;

  // Initialize game state
  const players = Array.from(
    { length: status.playerStatus.length },
    (_, i) => `player${i + 1}`
  );
  const simResponse = await initSimState(thread.id, players);

  // Update status with game state
  updateFromSimResponse(thread, {
    gameEnded: false,
    ...simResponse,
  });

  updateButtonEnabledStates(
    interaction.message,
    true,
    "continue",
    Array.from({ length: status.playerCount }, () => false)
  );
}

export async function continueGame(interaction: ButtonInteraction) {
  console.debug("[chaincraft-simulate] continueGame");
  await interaction.deferUpdate();

  const status = await getStatus(interaction.channel as ThreadChannel);

  updateButtonEnabledStates(
    interaction.message,
    false,
    "continue",
    Array.from({ length: status!.playerCount }, () => false)
  );

  try {
    const simResponse = await processAction(
      interaction.channelId!,
      "all players",
      `QUESTION: ${continueGameQuestion}`
    );

    // Update status with game state
    await updateFromSimResponse(
      interaction.channel as ThreadChannel,
      simResponse
    );
  } catch (error) {
    console.error(
      "[chaincraft-simulate] Error processing continue game action:",
      error
    );
  }

  updateButtonEnabledStates(
    interaction.message,
    true,
    "continue",
    Array.from({ length: status!.playerCount }, () => false)
  );
}

// Generic handler for player interactions (actions and questions)
// Modify the handlePlayerInteraction to only handle action/question
export async function handlePlayerInteraction(
  interaction: ButtonInteraction,
  interactionType: "action" | "question"
): Promise<void> {
  console.debug(
    `[chaincraft-simulate] handlePlayerInteraction - type: ${interactionType}`
  );

  // Validate player before showing modal
  const validation = await validatePlayerInteraction(interaction, {
    checkActionsAllowed: interactionType === "action",
  });

  if (!validation.valid) return;

  // Now we can defer the update since validation passed
  // await interaction.deferUpdate();

  // Show the appropriate modal based on interaction type
  if (interactionType === "action") {
    await showActionModal(interaction, validation.playerId!);
  } else {
    await showQuestionModal(interaction, validation.playerId!);
  }
}

// Maintain backward compatibility with existing code
export async function handlePlayerAction(
  interaction: ButtonInteraction
): Promise<void> {
  return handlePlayerInteraction(interaction, "action");
}

// Add new handler for player questions
export async function handlePlayerQuestion(
  interaction: ButtonInteraction
): Promise<void> {
  return handlePlayerInteraction(interaction, "question");
}

// Create a dedicated handler for the message button
export async function handlePlayerGetMessage(
  interaction: ButtonInteraction
): Promise<void> {
  console.debug("[chaincraft-simulate] handlePlayerGetMessage");

  // Validate player but don't check actions allowed
  const validation = await validatePlayerInteraction(interaction);

  // For get-message, we need to defer with ephemeral
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!validation.valid) return;

  // Retrieve and display the player message
  await retrieveAndShowPlayerMessage(interaction, validation.playerId!);
}

export async function processPlayerAction(
  playerId: string,
  interaction: ButtonInteraction | ModalSubmitInteraction,
  action: string
) {
  console.debug(
    "[chaincraft-simulate] processPlayerAction - playerId %s, action %s",
    playerId,
    action
  );
  const thread = interaction.channel as ThreadChannel;
  // Reply to the message with an initial response
  await interaction.reply({
    content: `${getPlayerTag(playerId)} Processing your action...`,
    flags: MessageFlags.Ephemeral,
  });

  const simResponse = await processAction(
    interaction.channelId!,
    playerId,
    action
  );

  // Send player messages
  let playerMessage = simResponse.playerStates.get(playerId)?.privateMessage;
  if (!playerMessage || playerMessage.length === 0) {
    playerMessage = "Action processed, but no message was returned.";
  }

  // Update status with game state
  await updateFromSimResponse(thread, simResponse, playerId);

  // Reply to the player who took the action
  await interaction.editReply({
    content: `${getPlayerTag(playerId)} ${playerMessage}`,
  });
}

// Helper function to validate if a player can interact with the game
async function validatePlayerInteraction(
  interaction: ButtonInteraction,
  options: { checkActionsAllowed?: boolean } = {}
): Promise<{ valid: boolean; playerId?: string; playerNumber?: number }> {
  // Check if user is assigned to this player role
  const assignedUser = await getAssignedUser(interaction);
  if (!assignedUser || assignedUser.assignedUserId != interaction.user.id) {
    await interaction.reply({
      content: `You are not assigned to the player ${assignedUser?.playerNumber} role.`,
      flags: MessageFlags.Ephemeral,
    });
    return { valid: false };
  }

  // Make sure the game is started
  const status = await getStatus(interaction.channel as ThreadChannel);
  if (!status || status.status !== SimStatus.RUNNING) {
    await interaction.reply({
      content:
        "Please start the game before taking actions or asking questions.",
      flags: MessageFlags.Ephemeral,
    });
    return { valid: false };
  }

  // For actions, verify that actions are allowed for this player
  if (
    options.checkActionsAllowed &&
    !status.playerStatus[assignedUser.playerNumber - 1].actionsAllowed
  ) {
    await interaction.reply({
      content: "No action is allowed for your player at this time.",
      flags: MessageFlags.Ephemeral,
    });
    return { valid: false };
  }

  return {
    valid: true,
    playerId: `player${assignedUser.playerNumber}`,
    playerNumber: assignedUser.playerNumber,
  };
}

// Function to retrieve and show the player message
async function retrieveAndShowPlayerMessage(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  playerId: string
): Promise<void> {
  console.debug(
    "[chaincraft-simulate] retrieveAndShowPlayerMessage - playerId %s",
    playerId
  );

  try {
    const simResponse = await getSimulationState(interaction.channelId!);

    const playerMessage =
      simResponse.playerStates.get(playerId)?.privateMessage;

    if (!playerMessage || playerMessage.length === 0) {
      await interaction.editReply({
        content: "No message available for this player.",
      });
      return;
    }

    await interaction.editReply({
      content: `${getPlayerTag(playerId)} ${playerMessage}`,
    });
  } catch (error) {
    console.error(
      "[chaincraft-simulate] Error retrieving player message:",
      error
    );
    await interaction.editReply({
      content: "Failed to retrieve your player message. Please try again.",
    });
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

async function getSetupMessage(
  thread: ThreadChannel
): Promise<Message | undefined> {
  const messages = await thread.messages.fetch({
    limit: 10,
    after: "0",
  });
  for (const [, message] of messages) {
    if (
      message.components.length > 1 &&
      message.components.some((row) =>
        row.components.some(
          (component) =>
            component instanceof ButtonComponent &&
            component.customId === resetSimId
        )
      )
    ) {
      return message;
    }
  }
  return undefined;
}

async function updateButtonEnabledStates(
  message: Message,
  startOrContinueEnabled: boolean,
  startOrContinue: "start" | "continue",
  playerButtons?: boolean[]
) {
  console.debug(
    "[chaincraft-simulate] updateButtonEnabledStates - startOrContinueEnabled: %s, startOrContinue: %s",
    startOrContinueEnabled,
    startOrContinue
  );
  const newComponents = message.components.map((row) => {
    const newRow = new ActionRowBuilder<ButtonBuilder>();
    for (const [index, component] of row.components.entries()) {
      if (component instanceof ButtonComponent) {
        let updatedComponent!: ButtonBuilder;
        if (
          component.customId === startGameId ||
          component.customId === continueGameId
        ) {
          updatedComponent = (
            startOrContinue === "start" ? startGameButton : continueGameButton
          ).setDisabled(!startOrContinueEnabled);
        } else if (
          component.customId?.startsWith(assumeRoleIdPrefix) &&
          playerButtons
        ) {
          const disabled = !playerButtons[index];
          updatedComponent = new ButtonBuilder()
            .setCustomId(component.customId!)
            .setLabel(component.label!)
            .setStyle(component.style)
            .setDisabled(disabled);
        } else {
          updatedComponent = new ButtonBuilder()
            .setCustomId(component.customId!)
            .setLabel(component.label!)
            .setStyle(component.style)
            .setDisabled(component.disabled);
        }
        newRow.addComponents(updatedComponent);
      }
    }
    return newRow;
  });

  await message.edit({ components: newComponents });
}

function getPlayerTag(playerId: string) {
  return `[Player ID: ${playerId}]`;
}
