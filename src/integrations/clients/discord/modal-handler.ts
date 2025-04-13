import {
  ActionRowBuilder,
  ButtonInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction,
} from "discord.js";
import { processPlayerAction } from "./chaincraft-simulate.js";

// Generic modal ID prefixes
const actionModalIdPrefix = "chaincraft_sim_action_modal";
const questionModalIdPrefix = "chaincraft_sim_question_modal";
const actionInputId = "chaincraft_sim_action_input";
const questionInputId = "chaincraft_sim_question_input";

interface ModalConfig {
  idPrefix: string;
  inputId: string;
  title: string;
  inputLabel: string;
  inputPlaceholder: string;
  style: TextInputStyle;
  processor: (playerId: string, interaction: ModalSubmitInteraction, input: string) => Promise<void>;
}

// Modal configurations
const modalConfigs: Record<string, ModalConfig> = {
  action: {
    idPrefix: actionModalIdPrefix,
    inputId: actionInputId,
    title: "Take Action",
    inputLabel: "What action would you like to take?",
    inputPlaceholder: "Describe your action here...",
    style: TextInputStyle.Paragraph,
    processor: processPlayerAction
  },
  question: {
    idPrefix: questionModalIdPrefix,
    inputId: questionInputId,
    title: "Ask Question",
    inputLabel: "What would you like to ask?",
    inputPlaceholder: "Type your question here...",
    style: TextInputStyle.Paragraph,
    // This will use the same processing function but can be customized in the future
    processor: (playerId, interaction, question) => 
      processPlayerAction(playerId, interaction, `QUESTION: ${question}`)
  }
};

export async function handleModalSubmit(
  interaction: ModalSubmitInteraction
): Promise<void> {
  console.debug(
    "[modal-handler] Handling modal submit - channelId:",
    interaction.channelId
  );
  
  // Determine which type of modal was submitted
  let modalType: string | undefined;
  let playerId: string | undefined;
  
  for (const [type, config] of Object.entries(modalConfigs)) {
    if (interaction.customId.startsWith(config.idPrefix)) {
      modalType = type;
      playerId = interaction.customId.split(`${config.idPrefix}_`)[1];
      break;
    }
  }
  
  if (!modalType || !playerId) return;
  
  const config = modalConfigs[modalType];
  const input = interaction.fields.getTextInputValue(config.inputId);
  
  console.debug(
    `[modal-handler] Processing ${modalType} for player ${playerId}: ${input}`
  );
  
  await config.processor(playerId, interaction, input);
}

export async function showModal(
  interaction: ButtonInteraction,
  playerId: string,
  modalType: string
): Promise<void> {
  const config = modalConfigs[modalType];
  if (!config) {
    console.error(`[modal-handler] Unknown modal type: ${modalType}`);
    return;
  }
  
  const modal = new ModalBuilder()
    .setCustomId(`${config.idPrefix}_${playerId}`)
    .setTitle(`${config.title} - ${playerId}`);

  const inputComponent = new TextInputBuilder()
    .setCustomId(config.inputId)
    .setLabel(config.inputLabel)
    .setStyle(config.style)
    .setPlaceholder(config.inputPlaceholder);

  const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
    inputComponent
  );

  modal.addComponents(actionRow);
  await interaction.showModal(modal);
}

// Convenience functions for common modal types
export async function showActionModal(
  interaction: ButtonInteraction,
  playerId: string
): Promise<void> {
  await showModal(interaction, playerId, 'action');
}

export async function showQuestionModal(
  interaction: ButtonInteraction,
  playerId: string
): Promise<void> {
  await showModal(interaction, playerId, 'question');
}
