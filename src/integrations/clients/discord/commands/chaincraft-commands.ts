import { SlashCommandBuilder } from "discord.js";
import type { CommandInteraction } from "discord.js";

import { startChaincraftDesign } from "#chaincraft/integrations/clients/discord/chaincraft-design.js";

const isDevelopment = process.env.NODE_ENV === 'development';
const commandName = isDevelopment 
  ? process.env.CHAINCRAFT_DEV_COMMAND_NAME 
  : process.env.CHAINCRAFT_COMMAND_NAME;

const chainCraftGameDescriptionOptionName = 'game_description';

const ChaincraftCommand = {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("Enter a description of a game you would like ChainCraft to design for you.")
        .addStringOption(option => option
            .setName(chainCraftGameDescriptionOptionName)
            .setDescription('The description of a game you want to design')),

    execute: async (interaction: CommandInteraction) => {
        startChaincraftDesign(interaction);
    }
}




export { ChaincraftCommand, chainCraftGameDescriptionOptionName }