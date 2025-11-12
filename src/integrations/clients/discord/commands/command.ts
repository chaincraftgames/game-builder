import type { ChatInputCommandInteraction, SlashCommandBuilder, SlashCommandOptionsOnlyBuilder } from "discord.js";

export interface ICommand {
	data: SlashCommandOptionsOnlyBuilder | SlashCommandBuilder;
	execute: (interaction: ChatInputCommandInteraction) => void | Promise<void>;
}