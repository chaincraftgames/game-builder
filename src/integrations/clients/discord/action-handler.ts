import {
  ActionRowBuilder,
  ButtonInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction,
} from "discord.js";

const actionModalIdPrefix = "chaincraft_sim_action_modal";
const actionInputId = "chaincraft_sim_action_input";

/** 
 * Cache handlers by thread and player id.  Key is thread id, value
 * is map of player id to action handler.
 */
const handlers = new Map<string, Map<string, ActionHandler>>();

export interface ActionProcessor {
//   (playerId: string, interaction: ModalSubmitInteraction, action: string): Promise<void>;
    (playerId: string, action: string): Promise<void>;
}

export function createActionHandler(
    threadId: string, 
    playerId: string, 
    processAction: ActionProcessor
): void {
    const handler = new ActionHandler(threadId, processAction);
    let playerHandlers = handlers.get(threadId);
    if (!playerHandlers) {
        playerHandlers = new Map();
        handlers.set(threadId, playerHandlers);
    }
    playerHandlers.set(playerId, handler);
}

export function getActionHandler(
    threadId: string,
    playerId: string
): ActionHandler | undefined {
  console.debug("[action-handler] Getting action handler - actionHandlers: %o", handlers);
  const playerHandlers = handlers.get(threadId);
  if (!playerHandlers) return undefined;
  return playerHandlers.get(playerId);
}

export function clearActionHandlers(threadId: string): void {
    handlers.delete(threadId);
}

export async function handleActionModalSubmit(
  interaction: ModalSubmitInteraction
): Promise<void> {
  console.debug("[action-handler] Handling action modal submit - channelId:", interaction.channelId);
  // Check if this is one of our modals
  if (!interaction.customId.startsWith(actionModalIdPrefix)) return;

  // Note suffix contains the leading "_"
  const playerId = interaction.customId.split(`${actionModalIdPrefix}_`)[1];
  const handler = handlers.get(interaction.channelId!)?.get(playerId);
  if (!handler) {
    console.error("No action handler found for thread %d and player %s:", interaction.channelId, playerId);
    return;
  }

  await handler.handleModalSubmit(interaction);
}

export class ActionHandler {
  private readonly threadId: string;
  private readonly processAction: ActionProcessor;

  constructor(threadId: string, processAction: ActionProcessor) {
    this.threadId = threadId;
    this.processAction = processAction;
  }

  async showActionModal(
    interaction: ButtonInteraction,
    playerId: string
  ): Promise<void> {
    const modal = new ModalBuilder()
      .setCustomId(`${actionModalIdPrefix}_${playerId}`)
      .setTitle(`Take Action - ${playerId}`);

    const actionInput = new TextInputBuilder()
      .setCustomId(actionInputId)
      .setLabel("What action would you like to take?")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Describe your action here...");

    const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
      actionInput
    );

    modal.addComponents(actionRow);
    await interaction.showModal(modal);
  }

  async handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    console.debug("[action-handler] Handling modal submit - interaction channelId: %d, threadId %d, customId: %s", interaction.channelId, this.threadId, interaction.customId);
    // Verify this modal is for our thread
    if (interaction.channelId !== this.threadId) return;
    await interaction.deferUpdate();

    const match = interaction.customId.match(
      new RegExp(`${actionModalIdPrefix}_(\\w+)`)
    );
    if (!match) return;

    const playerId = match[1];
    const action = interaction.fields.getTextInputValue(actionInputId);
    console.debug("[action-handler] Processing action for player %s: %s", playerId, action);

    // Use the cached action processor
    // await this.processAction(playerId, interaction, action);
    await this.processAction(playerId, action);
  }

  isActionModal(interaction: ModalSubmitInteraction): boolean {
    return interaction.customId.startsWith(actionModalIdPrefix);
  }
}
