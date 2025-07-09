import {
  ActionRowBuilder,
  APIEmbed,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  ForumChannel,
  ForumThreadChannel,
  Message,
  ThreadAutoArchiveDuration,
  ThreadChannel,
  User,
} from "discord.js";
import { getSpecificationForThread } from "#chaincraft/integrations/clients/discord/specification_manager.js";
import {
  createThreadInChannel,
} from "#chaincraft/integrations/clients/discord//util.js";
import { GameDesignSpecification } from "#chaincraft/ai/design/game-design-state.js";
import { storeThreadLink } from "./thread-link.js";
import { downloadFromIpfs, uploadToIpfs } from "#chaincraft/integrations/storage/pinata.js";
import { initializeSimulation } from "./chaincraft-simulate.js";

const gameLibraryChannelId = process.env.CHAINCRAFT_GAME_LIBRARY_CHANNEL_ID;
const gamePlayChannelId = process.env.CHAINCRAFT_SIMULATION_CHANNEL_ID;

const playGameId = "chaincraft_game_library_play";

const playGameButton = new ButtonBuilder()
  .setCustomId(playGameId)
  .setLabel("Play")
  .setStyle(ButtonStyle.Success);

const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
  playGameButton
);

interface PAIT {
    game_title: string;
    game_specification: GameDesignSpecification;
    spec_version: number;
    image_url?: string;
}

export async function publishChaincraftDesign(interaction: ButtonInteraction) {
  if (!interaction.channel || !(interaction.channel instanceof ThreadChannel)) {
    await interaction.reply({
      content: "This interaction can only occur in a thread.",
      ephemeral: true,
    });
    return;
  }

  // Acknowledge the interaction immediately
  await interaction.deferReply({ ephemeral: true });
  await interaction.editReply({
    content: "Publish Design - 🔄 Retrieving the full design specification...",
  });

  const specResult = await getSpecificationForThread(
    interaction.channel as ThreadChannel
  );

  if (!specResult) {
    await interaction.editReply({
      content:
        "Failed to retrieve the game specification. Please try again later.",
    });
    return;
  }

  console.debug("[chaincraft-design] - Retrieved spec result: %o", specResult);

  const { specification, version } = specResult;

  // Check if this version is already published
  let post: ForumThreadChannel | undefined;
  let existingPostMessage: Message | undefined;
  const postId = await _getStoredPostId(interaction.channel as ThreadChannel);
  if (postId) {
    post =
      ((await interaction.client.channels.fetch(
        postId
      )) as ForumThreadChannel) ?? undefined;
    if (!post) {
      console.error("Post not found.");
      return;
    }
    existingPostMessage = await _getPostMessage(post);
  }

  if (existingPostMessage) {
    const existingVersion = existingPostMessage.embeds[0].fields.find(
      (field) => field.name === "Version"
    )?.value;
    console.debug(
      "[chaincraft-game-library] - Existing version: %s",
      existingVersion
    );
    if (existingVersion && parseInt(existingVersion) >= version) {
      await interaction.editReply({
        content: `⚠️ Version ${version} has already been published. Please update the game design to publish a new version.`,
      });
      return;
    }
  }

  await interaction.editReply({
    content:
      "Publish Design - 📝 Uploading specification and generating token...",
  });
  const ipfsHash = await _uploadChaincraftDesign(
    interaction.channel as ThreadChannel,
    interaction.user,
    specResult.specification,
    specResult.version
  )

  const gameTitle = interaction.channel.name;
  const imageUrl = await _getImageUrlFromThread(interaction.channel);
  const postTitle = `${gameTitle} - v${version}`;

  const embed = new EmbedBuilder()
    .setTitle(postTitle)
    .setDescription(specification.summary || "Game summary not available")
    .addFields(
      {
        name: "Players",
        value:
          specification.playerCount.min != specification.playerCount.max
            ? `${specification.playerCount.min} to ${specification.playerCount.max}`
            : `${specification.playerCount.min}`,
      },
      { name: "Version", value: version.toString() },
        { name: "PAIT", value: ipfsHash },
    )
    .setFooter({
      text: `Created by ${interaction.user.username}`,
      iconURL: interaction.user.displayAvatarURL(),
    });

  if (imageUrl) {
    embed.setImage(imageUrl);
    //   .setThumbnail(imageUrl);
  }

  // If there is an existing post, append a new message and edit the original message.
  if (existingPostMessage) {
    await updatePost(existingPostMessage, embed as APIEmbed);
    await _storePostId(
      interaction,
      interaction.channel as ThreadChannel,
      existingPostMessage.channel as ThreadChannel
    );
  } else {
    const channel = (await interaction.client.channels.fetch(
      gameLibraryChannelId
    )) as ForumChannel;
    post = await channel.threads.create({
      name: postTitle,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
      message: {
        content: "",
        embeds: [embed],
        components: [actionRow],
      },
    });
    await _storePostId(interaction, interaction.channel as ThreadChannel, post);
  }
  interaction.editReply({
    content: `The game design has been successfully published.  [Click here to view it in the game library.](<${
      post!.url
    }>)`,
  });
}

export async function handlePlayGameButton(
  interaction: ButtonInteraction
): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    // Get the PAIT from the interaction message
    const message = interaction.message as Message;
    const embed = message.embeds[0];
    const paItField = embed.fields.find((field) => field.name === "PAIT");
    if (!paItField) {
        await interaction.editReply({
            content: "Failed to start game.  Missing token",
        });
        return;
        }
    
        // Retrieve the token from the field value
        const token = await downloadFromIpfs<PAIT>(paItField.value);
        if (!token) {
            await interaction.editReply({
                content: "Failed to start game.  Token not found",
            });
            return;
        }
        console.debug("[chaincraft-game-library] - Token found, starting game");

        const { game_title, game_specification, spec_version } = token as PAIT;

        // Create a new thread in the game playing channel
        const gameThread = await createThreadInChannel(
              interaction.client,
              gamePlayChannelId as string,
              `🎲 ${game_title} Session - created by ${interaction.user.tag}`,
              false
            );
        if (!gameThread) {
          await interaction.editReply({
            content: "Failed to create a game thread.",
          });
          return;
        }

        await initializeSimulation(
          gameThread,
          interaction.user,
          game_specification,
          spec_version,
        )

        await interaction.editReply({
          content: `Game session started! [Click here to join the game thread.](${gameThread.url})`,
        });
}

async function _uploadChaincraftDesign(
  thread: ThreadChannel,
  user: User,
  specification: GameDesignSpecification,
  version: number
): Promise<string> {
  const gameTitle = thread.name;
  const name = `PAIT_${user.id}_${gameTitle.replace(/\s/g, "_")}`;

  const token: PAIT = {
    game_title: gameTitle,
    game_specification: specification,
    spec_version: version,
    image_url: await _getImageUrlFromThread(thread),
  };

  return await uploadToIpfs(token, name);
}

async function _getImageUrlFromThread(
  thread: ThreadChannel
): Promise<string | undefined> {
  // Get total message count from thread
  const messageCount = thread.messageCount;
  if (!messageCount) {
    console.error("No messages found in thread.");
    return;
  }

  // Fetch all messages in the thread
//   const messages = await thread.messages.fetch({ limit: messageCount });
   const messages = await thread.messages.fetch({
    limit: 1,
    after: "0",
   });
  const firstMessage = messages.last();

  const attachment = firstMessage!.attachments.first();
  console.debug("[chaincraft-design] Attachment:", attachment);
  return attachment?.url;
}

async function _getStoredPostId(thread: ThreadChannel) {
  // Get the pinned message from the thread
  const pinnedMessages = (await thread.messages.fetchPinned()).filter(
    (m: Message) => m.author.bot
  );

  // If there are no pinned messages, return
  if (pinnedMessages.size === 0) {
    return;
  }

  const postMessage = pinnedMessages.first();
  const match = postMessage?.content.match(
    /https:\/\/discord\.com\/channels\/\d+\/(\d+)(?:\/(\d+))?/
  );
  if (!match) {
    console.error(
      "Did not find a post link in the pinned message.",
      postMessage
    );
  }
  return match ? match[1] : undefined;
}

async function _storePostId(
  interaction: ButtonInteraction,
  designThread: ThreadChannel,
  post: ThreadChannel
) {
  await storeThreadLink(designThread, post.id, "shared");

  if (!interaction.replied) {
    await interaction.followUp({
      content: "The updated game design has been shared.",
      ephemeral: true,
    });
  }
}

async function _getPostMessage(
  post: ThreadChannel
): Promise<Message | undefined> {
  // Fetch the starter message specifically (first message of the thread)
  const starterMessage = (await post.fetchStarterMessage()) ?? undefined;

  // Check if message has embeds
  if ((starterMessage?.embeds?.length ?? 0) == 0) {
    console.error(
      "[chaincraft-game-library] No embeds found in the starter message."
    );
    return;
  }

  return starterMessage;
}

async function updatePost(postMessage: Message, embed: APIEmbed) {
  console.debug(
    "[chaincraft-game-library] - Updating post with new embed: %o",
    embed
  );
  // Update the post name with the new embed title.
  // If the embed is an EmbedBuilder (likely), then we have to access the embed
  // title through the data property.
  const newTitle =
    embed.title || (embed as any).data.title || postMessage.embeds[0].title;
  console.debug(
    "[chaincraft-game-library] - New title for the post: %s",
    newTitle
  );
  await (postMessage.channel as ForumThreadChannel).setName(newTitle!);

  // Get the existing embed
  const existingEmbed = postMessage.embeds[0];

  // Add the existing embed to a new message in the post
  await (postMessage.channel as ForumThreadChannel).send({
    embeds: [existingEmbed],
    components: [actionRow],
  });

  // Update the post message with the new embed
  await postMessage.edit({
    embeds: [embed],
    components: [actionRow],
  });
}
