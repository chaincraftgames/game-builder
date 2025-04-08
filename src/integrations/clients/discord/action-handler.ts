import {
  ActionRowBuilder,
  ButtonInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction,
} from "discord.js";
import { processPlayerAction } from "./chaincraft-simulate.js";

const actionModalIdPrefix = "chaincraft_sim_action_modal";
const actionInputId = "chaincraft_sim_action_input";

export async function handleActionModalSubmit(
  interaction: ModalSubmitInteraction
): Promise<void> {
  console.debug(
    "[action-handler] Handling action modal submit - channelId:",
    interaction.channelId
  );
  // Check if this is one of our modals
  if (!interaction.customId.startsWith(actionModalIdPrefix)) return;

  // Note suffix contains the leading "_"
  const playerId = interaction.customId.split(`${actionModalIdPrefix}_`)[1];

  const action = interaction.fields.getTextInputValue(actionInputId);
  console.debug(
    "[action-handler] Processing action for player %s: %s",
    playerId,
    action
  );

  // Use the cached action processor
  // await this.processAction(playerId, interaction, action);
  await processPlayerAction(playerId, interaction, action);
}

export async function showActionModal(
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
