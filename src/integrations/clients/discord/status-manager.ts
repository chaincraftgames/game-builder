import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonComponent,
  ButtonInteraction,
  ButtonStyle,
  Message,
  ThreadChannel,
} from "discord.js";
import {
  RuntimePlayerState,
  SimResponse,
} from "#chaincraft/ai/simulate/simulate-workflow.js";

const playerActionIdPrefix = "chaincraft_sim_action_player";
const playerQuestionIdPrefix = "chaincraft_sim_question_player";
const playerMessageIdPrefix = "chaincraft_sim_message_player";
const gameStatusPrefix = "Status:";
const playerCountPrefix = "Player Count:";
const statusMessagePrefix = "## Game State ##";
const playerStatusMessagePrefix = "### Player Controls ###";

// Cache for status info which includes the message
const statusCache = new Map<string, StatusInfo>();

const buttonIdRegex = new RegExp(
  `^(${playerActionIdPrefix}|${playerQuestionIdPrefix}|${playerMessageIdPrefix})_(\\d+)_([^\s_]+)$`
);

const statusMessageRegex = new RegExp(
  `^${statusMessagePrefix}\\s*${playerCountPrefix}\\s*(\\d+)\\s*${gameStatusPrefix}\\s*([^\n]+)`
);

type PlayerRoleAssignment = {
  playerNumber: number;
  assignedUserId?: string;
};

type PlayerStatus = PlayerRoleAssignment &
  Omit<RuntimePlayerState, "illegalActionCount" | "actionRequired">;

export const SimStatus = {
  INITIALIZING: "Initializing...",
  WAITING_FOR_PLAYERS: "Waiting for players",
  READY_TO_START: "Ready to start!",
  STARTING: "Game is starting.  Please wait...",
  RUNNING:
    "Game started! Check your ephemeral messages for your player information.",
  GAME_ENDED: "The game has ended.  Please reset the simulation to play again.",
};

export interface StatusInfo {
  statusMessage?: Message;
  playerStatusMessage?: Message;
  playerCount: number;
  status: string;
  playerStatus: PlayerStatus[];
}

/**
 * Initializes the status message for the game thread.
 * @param thread The thread channel to send the status message to.
 * @param playerCount The number of players in the game.  If not provided, and the thread
 * already has a status message, it will be used to determine the player count.
 */
export async function initStatus(
  thread: ThreadChannel,
  playerCount?: number
): Promise<StatusInfo> {
  // Check if the thread already has a status message
  let status = await getStatus(thread);
  if (!status) {
    if (!playerCount) {
      console.error(
        "[status-manager] No player count provided and no status message found."
      );
      throw new Error("No player count provided and no status message found.");
    }
    // If no status message exists, create a new one
    const statusMessage = await thread.send({
      content: "Initializing...",
    });

    const playerStatusMessage = await thread.send({
      content: playerStatusMessagePrefix,
    });

    status = {
      statusMessage: statusMessage,
      playerStatusMessage: playerStatusMessage,
      playerCount,
      status: SimStatus.WAITING_FOR_PLAYERS,
      playerStatus: [],
    };

    // Cache the status info
    statusCache.set(thread.id, status);
  } else {
    // If a status message exists, update it
    status.status = SimStatus.WAITING_FOR_PLAYERS;
  }

  // If player count is not provided, try to get it from the status message (reset scenario).
  if (!playerCount) {
    playerCount = status.playerCount;
  }
  const playerStatuses = initPlayerStatus(playerCount);
  status.playerStatus = playerStatuses;
  await updateStatus(thread, status, undefined);
  return status;
}

export async function getStatus(
  thread: ThreadChannel
): Promise<StatusInfo | undefined> {
  // Check cache first
  const cached = statusCache.get(thread.id);
  if (cached) {
    console.debug("[status-manager] Cache hit for thread:", thread.id);
    return cached;
  }

  // Find status message if not cached
  const messages = await thread.messages.fetch({ limit: 100 });
  let statusMessage: Message | undefined;
  let playerStatusMessage: Message | undefined;
  for (const message of messages.values()) {
    if (message.author.bot) {
      if (message.content.startsWith("## Game State ##")) {
        statusMessage = message;
        console.debug(
          "[status-manager] Found status message:",
          message.content
        );
      } else if (message.content.startsWith(playerStatusMessagePrefix)) {
        playerStatusMessage = message;
        console.debug(
          "[status-manager] Found player status message:",
          message.content
        );
      }
    }
  }

  if (!statusMessage || !playerStatusMessage) {
    console.debug(
      "[status-manager] No status message found in thread:",
      thread.id
    );
    return;
  }

  // Get game status
  const statusMatch = statusMessage.content.match(statusMessageRegex);
  if (!statusMatch) {
    console.error(
      "[status-manager] Invalid status message format:",
      statusMessage.content
    );
    throw new Error("Invalid status message format");
  }
  const [, playerCount, status] = statusMatch;

  // Get player status
  let playerStatuses: PlayerStatus[];
  const actionRows = playerStatusMessage.components;

  // Ensure that player statuses are initialized
  playerStatuses = initPlayerStatus(parseInt(playerCount));
    try {
      for (const [index, row] of actionRows.entries()) {
        // First button is action, second is message
        const actionButton = row.components[0] as ButtonComponent;
        const messageButton = row.components[1] as ButtonComponent;
        const match = actionButton?.customId?.match(buttonIdRegex);
        if (!match) {
          console.error(
            "[status-manager] Invalid button ID format:",
            actionButton.customId
          );
          throw new Error("Invalid button ID format");
        }
        const [, , playerNumber, assignedUserId] = match;
        playerStatuses[index] = {
          playerNumber: parseInt(playerNumber),
          assignedUserId: assignedUserId,
          actionsAllowed: !actionButton.disabled
        };
      };
    } catch (error) {
      console.error("[status-manager] Error parsing player statuses:", error);
      return;
    }

  const statusInfo = {
    statusMessage,
    playerStatusMessage,
    status,
    playerCount: parseInt(playerCount),
    playerStatus: playerStatuses,
  };

  // Cache the parsed status
  statusCache.set(thread.id, statusInfo);
  return statusInfo;
}

export async function updateStatus(
  thread: ThreadChannel,
  status: StatusInfo,
  publicMessage?: string
): Promise<void> {
  console.debug("[statusManager] updateStatus", thread.id, status);
  const currentStatus = await getStatus(thread);
  if (!currentStatus) {
    throw new Error("Status info not found");
  }
  console.debug("[statusManager] currentStatus", currentStatus);

  const statusMessage = currentStatus.statusMessage;
  await statusMessage!.edit({
    content: formatStatusContent(status, publicMessage),
  });

  const playerStatusMessage = currentStatus.playerStatusMessage;
  await playerStatusMessage!.edit({
    content: "### Player Controls ###",
    components: formatPlayerStatusContent(status.status, status.playerStatus),
  });

  // Update cache with new status
  statusCache.set(thread.id, status);
}

export function clearStatus(threadId: string): void {
  statusCache.delete(threadId);
  console.debug("[statusManager] Cleared status cache for thread:", threadId);
}

export function getAssignedUser(
  interaction: ButtonInteraction
): PlayerRoleAssignment | undefined {
  const match = interaction.customId.match(buttonIdRegex);
  if (!match) {
    return;
  }
  const [, , playerNumber, userId] = match;
  return {
    playerNumber: parseInt(playerNumber),
    assignedUserId: userId,
  };
}

export async function updateFromSimResponse(
  thread: ThreadChannel,
  simResponse: SimResponse,
  currentPlayer?: string
) {
  const status = await getStatus(thread);
  if (!status) {
    throw new Error("Status info not found");
  }

  const updatedPlayerStatuses = [...status.playerStatus];
  for (const playerStatus of status.playerStatus) {
    const playerId = `player${playerStatus.playerNumber}`;
    const player = simResponse.playerStates.get(playerId);
    if (player) {
      playerStatus.actionsAllowed = player.actionsAllowed;
      // Set the private message only if the player is not the current player
      // and the player has a private message
      playerStatus.privateMessage =
        playerId === currentPlayer ? undefined : player.privateMessage;
    }
  }

  await updateStatus(
    thread,
    {
      ...status,
      status: simResponse.gameEnded ? SimStatus.GAME_ENDED : SimStatus.RUNNING,
      playerStatus: updatedPlayerStatuses,
    },
    simResponse.publicMessage
  );
}

// Format status message content
function formatStatusContent(
  status: StatusInfo,
  publicMessage?: string
): string {
  let content = `
${statusMessagePrefix}\n
${playerCountPrefix} ${status.playerCount}\n
${gameStatusPrefix} ${status.status}\n

### Player Assignments ###\n
${
  status.playerStatus.map((player) => {
    const playerAssignment = player.assignedUserId 
      ? `<@${player.assignedUserId}>` 
      : "Not assigned";
    
    return `Player ${player.playerNumber}: ${playerAssignment}`;
  }).join("\n")
}
${
  publicMessage
    ? `### Game Update: ###
${publicMessage}\n\n`
    : ""
}`;

  return content;
}

function formatPlayerStatusContent(
  simStatus: string,
  playerStatuses: PlayerStatus[]
): ActionRowBuilder<ButtonBuilder>[] {
  const actionRows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (const status of playerStatuses) {
    if (!status.assignedUserId) {
      continue;
    }

    actionRows.push(
      createPlayerControls(
        status.assignedUserId,
        simStatus,
        playerStatuses.indexOf(status) + 1,
        status
      )
    );
  }

  return actionRows;
}

function createPlayerControls(
  userId: string,
  simStatus: string,
  playerNumber: number,
  playerStatus: PlayerStatus
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${playerActionIdPrefix}_${playerNumber}_${userId}`)
      .setLabel(`P${playerNumber} 🎲 Action`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!playerStatus?.actionsAllowed),
    new ButtonBuilder()
      .setCustomId(`${playerQuestionIdPrefix}_${playerNumber}_${userId}`)
      .setLabel(`P${playerNumber} ❓ Question`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(simStatus !== SimStatus.RUNNING),
    new ButtonBuilder()
      .setCustomId(`${playerMessageIdPrefix}_${playerNumber}_${userId}`)
      .setLabel(`P${playerNumber} 📫 Get Message`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!playerStatus?.privateMessage)
  );
}

function initPlayerStatus(playerCount: number): PlayerStatus[] {
  console.debug(
    "[status-manager] Initializing player status for %d players",
    playerCount
  );
  return Array.from({ length: playerCount }, (_, index) => ({
    playerNumber: index + 1,
    actionsAllowed: false,
    pendingMessage: false,
  }));
}
