import 'dotenv/config.js';
import { REST, Routes } from 'discord.js';

import type { ICommand } from '#chaincraft/integrations/clients/discord/commands/command.js';
import { ChaincraftCommand } from '#chaincraft/integrations/clients/discord/commands/chaincraft-commands.js';

const {
    CHAINCRAFT_DISCORD_BOT_TOKEN: token,
    APP_ID: clientId
} = process.env;

const commandData = (ChaincraftCommand as ICommand).data
const commands = [
    commandData.toJSON(),
];

const commandRoute = Routes.applicationCommands(clientId as string) 

// Construct and prepare an instance of the REST module
const rest = new REST().setToken(token as string);

// and deploy your commands!
(async () => {
	try {
		console.log(`Started refreshing ${commands.length} application (/) commands.`);

		// The put method is used to fully refresh all commands in the guild with the current set
		const data = await rest.put(
			commandRoute,
			{ body: commands },
		);

		console.log(`Successfully reloaded ${commands.length} application (/) commands: ${commands.map(command => command.name).join(', ')}`);
	} catch (error) {
		// And of course, make sure you catch and log any errors!
		console.error(error);
	}
})();