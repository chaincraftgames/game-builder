import { Events, Interaction, Message, ThreadChannel } from "discord.js";
import {
  shareChaincraftDesign,
  uploadChaincraftDesign,
  simulateChaincraftDesign,
  handleDesignMessage,
} from "#chaincraft/integrations/clients/discord/chaincraft-design.js";
import { handleSimulationMessage } from "#chaincraft/integrations/clients/discord/chaincraft-simulate.js";

const designChannelId = process.env.CHAINCRAFT_DESIGN_CHANNEL_ID;
const simulationChannelId = process.env.CHAINCRAFT_SIMULATION_CHANNEL_ID;

const ChaincraftOnMessage = {
  name: Events.MessageCreate,
  execute: async (message: Message) => {
    try {
      // Ignore if from bot or not in thread
      if (message.author.bot || !message.channel.isThread()) {
        return;
      }

      // design message
      if (message.channel.parentId === designChannelId) {
        handleDesignMessage(message);
        // simulation message
      } else if (message.channel.parentId === simulationChannelId) {
        handleSimulationMessage(message);
      }
    } catch (error) {
      console.error("Unhandled error in ChaincraftOnMessage: ", error);
    }
  },
};

const ChaincraftOnThreadDelete = {
  name: Events.ThreadDelete,
  execute: async (thread: ThreadChannel) => {
    try {
      // TODO remove the conversation from memory
      // removeDesignConversation(thread.id);
    } catch (error) {
      console.error("Unhandled error in ChaincraftOnThreadDelete: ", error);
    }
  },
};

// const ChaincraftOnApprove = {
//   name: Events.InteractionCreate,
//   execute: async (interaction: Interaction) => {
//     try {
//       if (
//         interaction.isButton() &&
//         interaction.customId === "chaincraft_approve_design"
//       ) {
//         await approveChaincraftDesign(interaction);
//       }
//     } catch (error) {
//       console.error("Unhandled error in ChaincraftOnApprove: ", error);
//     }
//   },
// };

const ChaincraftOnShare = {
  name: Events.InteractionCreate,
  execute: async (interaction: Interaction) => {
    try {
      if (
        interaction.isButton() &&
        interaction.customId === "chaincraft_share_design"
      ) {
        await shareChaincraftDesign(interaction);
      }
    } catch (error) {
      console.error("Unhandled error in ChaincraftOnShare: ", error);
    }
  },
};

const ChaincraftOnUpload = {
  name: Events.InteractionCreate,
  execute: async (interaction: Interaction) => {
    try {
      if (
        interaction.isButton() &&
        interaction.customId === "chaincraft_upload_design"
      ) {
        await uploadChaincraftDesign(interaction);
      }
    } catch (error) {
      console.error("Unhandled error in ChaincraftOnUpload: ", error);
    }
  },
};

const ChaincraftOnSimulate = {
  name: Events.InteractionCreate,
  execute: async (interaction: Interaction) => {
    try {
      if (
        interaction.isButton() &&
        interaction.customId === "chaincraft_simulate_design"
      ) {
        await simulateChaincraftDesign(interaction);
      }
    } catch (error) {
      console.error("Unhandled error in ChaincraftOnUpload: ", error);
    }
  },
};

export {
  ChaincraftOnMessage,
  //   ChaincraftOnApprove,
  ChaincraftOnShare,
  ChaincraftOnThreadDelete,
  ChaincraftOnUpload,
  ChaincraftOnSimulate,
};
