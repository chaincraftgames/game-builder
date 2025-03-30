import { Message, ThreadChannel } from "discord.js";
import { PlayerStates } from "#chaincraft/ai/simulate/simulate-workflow.js";

// Single cache for status info which includes the message
const statusCache = new Map<string, StatusInfo>();

export const SimStatus = {
  WAITING_FOR_PLAYERS: "Waiting for players",
  READY_TO_START: "Ready to start!",
  RUNNING:
    "Game started! Check your ephemeral messages for your player information.",
  GAME_ENDED: "The game has ended.  Please reset the simulation to play again.",
};

export enum PlayerStatusType {
  UNASSIGNED = "WAITING",
  ASSIGNED = "SELECTED",
  AWAITING_ACTION = "AWAITING_ACTION",
  NO_ACTION_REQUIRED = "NO_ACTION_REQUIRED",
  PENDING_MESSAGE = "PENDING_MESSAGE",
}

const PlayerStatus: Record<
  PlayerStatusType,
  { icon: string; message: string }
> = {
  [PlayerStatusType.UNASSIGNED]: {
    icon: "❌",
    message: "Unassigned. Click the Player button to take control.",
  },
  [PlayerStatusType.ASSIGNED]: {
    icon: "✅",
    message: "Selected",
  },
  [PlayerStatusType.AWAITING_ACTION]: {
    icon: "🎯",
    message: "Your turn! Click 'Take Action' to make your move.",
  },
  [PlayerStatusType.NO_ACTION_REQUIRED]: {
    icon: "⏳",
    message: "Waiting for other players",
  },
  [PlayerStatusType.PENDING_MESSAGE]: {
    icon: "📫",
    message: "Pending message. Click 'Update' to see the latest message.",
  },
};

const playerStatusRegex = new RegExp(
  `Player (\\d+): (${Object.values(PlayerStatus)
    .map((status) => status.icon.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})`,
  "g"
);

export interface StatusInfo {
  message: Message;
  status: string;
  playerStatus: PlayerStatusType[];
}

// Helper to get status message with caching
export async function getStatusMessage(
  thread: ThreadChannel
): Promise<Message | undefined> {
  const status = await getStatus(thread);
  return status?.message;
}

// Create initial player statuses for game setup
export function createInitialPlayerStatus(
  playerCount: number
): PlayerStatusType[] {
  return Array.from({ length: playerCount }, () => PlayerStatusType.UNASSIGNED);
}

// Map runtime player states to status types after game starts
export function mapPlayerStatesToStatus(
  playerStates: PlayerStates,
  currentPlayerId?: string,
): PlayerStatusType[] {
  const result: PlayerStatusType[] = [];

  for (const [playerId, state] of playerStates) {
    const index = parseInt(playerId.slice(-1)) - 1;
    if (state.privateMessage && playerId !== currentPlayerId) {
      result[index] = PlayerStatusType.PENDING_MESSAGE;
    } else if (state.actionRequired || state.actionsAllowed) {
      result[index] = PlayerStatusType.AWAITING_ACTION;
    } else {
      result[index] = PlayerStatusType.NO_ACTION_REQUIRED;
    }
  }

  return result;
}

// Format status message content
function formatStatusContent(
  status: string,
  playerStatus: PlayerStatusType[],
  publicMessage?: string
): string {
  let content = `Status: ${status}\n\n
${
  publicMessage
    ? `Game Update:
${publicMessage}\n\n`
    : ""
}
${playerStatus
  .map((status, i) => {
    const { icon, message } = PlayerStatus[status];
    return `Player ${i + 1}: ${icon} ${message}`;
  })
  .join("\n")}
`;

  return content;
}

export async function getStatus(
  thread: ThreadChannel
): Promise<StatusInfo | undefined> {
  // Check cache first
  const cached = statusCache.get(thread.id);
  if (cached) {
   return cached;
  }

  // Find status message if not cached
  const messages = await thread.messages.fetch({ limit: 100 });
  const statusMessage = messages.find(message => 
    message.content.startsWith("Status:")
  );
  if (!statusMessage) return;
  
  // Get game status
  const statusMatch = statusMessage.content.match(/Status: (.*)/);
  if (!statusMatch?.[1]) return;

  // First pass - find highest player number to size array
  const playerLines = Array.from(
    statusMessage.content.matchAll(playerStatusRegex)
  );

  if (playerLines.length === 0) {
    return;
  }

  const maxPlayer = Math.max(...playerLines.map((match) => parseInt(match[1])));
  const playerStatus = new Array<PlayerStatusType>(maxPlayer);

  // Second pass - set player statuses at correct indices
  for (const [_, playerNum, icon] of playerLines) {
    const index = parseInt(playerNum) - 1;
    const status = getStatusFromIcon(icon);
    if (status) {
      playerStatus[index] = status;
    }
  }

  const statusInfo = {
    message: statusMessage,
    status: statusMatch[1],
    playerStatus,
  };

  // Cache the parsed status
  statusCache.set(thread.id, statusInfo);
  return statusInfo;
}

// Single update function that handles both pre-game and in-game updates
export async function updateStatus(
  thread: ThreadChannel,
  status?: string,
  playerStatus?: PlayerStatusType[],
  publicMessage?: string
): Promise<StatusInfo | undefined> {
  console.debug("[statusManager] updateStatus", {
    status,
    playerStatus,
    publicMessage,
  });
  let currentStatus;
  if (!playerStatus) {
    currentStatus = await getStatus(thread);
    if (!currentStatus) return;
    playerStatus = createInitialPlayerStatus(currentStatus.playerStatus.length);
  }

  let statusMessage = currentStatus?.message ?? await getStatusMessage(thread);
  if (!statusMessage) {
    statusMessage = await thread.send("Status: Initializing...");
  }

  status = status ?? SimStatus.WAITING_FOR_PLAYERS;
  const content = formatStatusContent(status, playerStatus, publicMessage);
  await statusMessage.edit({ content });

  // Update cache with new status
  const statusInfo = {
    message: statusMessage,
    status,
    playerStatus,
  };
  statusCache.set(thread.id, statusInfo);
  return statusInfo;
}

export function clearStatus(threadId: string): void {
  statusCache.delete(threadId);
  console.debug("[statusManager] Cleared status cache for thread:", threadId);
}

function getStatusFromIcon(icon: string): PlayerStatusType | undefined {
  return Object.entries(PlayerStatus).find(
    ([_, status]) => status.icon === icon
  )?.[0] as PlayerStatusType | undefined;
}
