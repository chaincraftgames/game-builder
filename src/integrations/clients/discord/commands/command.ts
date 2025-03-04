import type { CommandInteraction, SlashCommandBuilder, SlashCommandOptionsOnlyBuilder } from "discord.js";

export interface ICommand {
	data: SlashCommandOptionsOnlyBuilder | SlashCommandBuilder;
	execute: (interaction: CommandInteraction) => void;
}