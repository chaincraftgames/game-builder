// Load the environment variables from the .env file
import "dotenv/config.js";
import { Client, Collection, Events, GatewayIntentBits } from "discord.js";

import { 
    ChaincraftOnMessage,
    ChainCraftOnResetSimulation,
    // ChaincraftOnApprove,
    ChaincraftOnShare,
    ChainCraftOnSimAssumeRole,
    ChaincraftOnSimModalSubmit,
    ChaincraftOnSimPlayerAction,
    ChaincraftOnSimPlayerGetMessage,
    ChaincraftOnSimPlayerQuestion,
    ChainCraftOnSimStartGame,
    ChaincraftOnSimulate,
    ChaincraftOnThreadDelete,
    ChaincraftOnUpload
} from "#chaincraft/integrations/clients/discord/events/chaincraft-events.js";
import type { ICommand } from "#chaincraft/integrations/clients/discord/commands/command.js";
import { ChaincraftCommand } from "#chaincraft/integrations/clients/discord/commands/chaincraft-commands.js";

const isDevelopment = process.env.NODE_ENV === 'development';
const token = isDevelopment 
  ? process.env.CHAINCRAFT_DEV_DISCORD_BOT_TOKEN 
  : process.env.CHAINCRAFT_DISCORD_BOT_TOKEN;

// Listen for unhandled rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

const commands = new Collection<string, ICommand>();

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// When the client is ready, run this code (only once).
// The distinction between `client: Client<boolean>` and `readyClient: Client<true>` is important for TypeScript developers.
// It makes some properties non-nullable.
client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

// Log in to Discord with your client's token
client.login(token);

commands.set(ChaincraftCommand.data.name, ChaincraftCommand);

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);

  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: "There was an error while executing this command!",
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: "There was an error while executing this command!",
        ephemeral: true,
      });
    }
  }
});

// Increase the maximum number of listeners
client.setMaxListeners(15); // Set to a number higher than the number of listeners you need

// Register events
client.on(Events.MessageCreate, (message) => ChaincraftOnMessage.execute(message));
// client.on(Events.InteractionCreate, (interaction) => ChaincraftOnApprove.execute(interaction));
client.on(Events.InteractionCreate, (interaction) => ChaincraftOnShare.execute(interaction));
client.on(Events.ThreadDelete, (thread) => ChaincraftOnThreadDelete.execute(thread));
client.on(Events.InteractionCreate, (interaction) => ChaincraftOnUpload.execute(interaction));
client.on(Events.InteractionCreate, (interaction) => ChaincraftOnSimulate.execute(interaction));
client.on(Events.InteractionCreate, (interaction) => ChainCraftOnResetSimulation.execute(interaction));
client.on(Events.InteractionCreate, (interaction) => ChainCraftOnSimAssumeRole.execute(interaction));
client.on(Events.InteractionCreate, (interaction) => ChainCraftOnSimStartGame.execute(interaction));
client.on(Events.InteractionCreate, (interaction) => ChaincraftOnSimPlayerAction.execute(interaction));
client.on(Events.InteractionCreate, (interaction) => ChaincraftOnSimPlayerQuestion.execute(interaction));
client.on(Events.InteractionCreate, (interaction) => ChaincraftOnSimModalSubmit.execute(interaction));
client.on(Events.InteractionCreate, (interaction) => ChaincraftOnSimPlayerGetMessage.execute(interaction));

