import {
  ActionRowBuilder,
  ButtonBuilder,
  ChannelType,
  Client,
  TextChannel,
  ThreadChannel,
  ForumChannel,
  ThreadAutoArchiveDuration,
  APIEmbed,
} from "discord.js";

// TODO: Move pinata interface to game builder integrations
import { PinataSDK } from "pinata-web3";

const pinataJwt = process.env.CHAINCRAFT_PINATA_JWT;
const pinataGateway = process.env.CHAINCRAFT_PINATA_GATEWAY;

export async function createThreadInChannel(
  client: Client,
  channelId: string,
  threadName: string,
  privateThread: boolean = false
) {
  // Fetch the channel by ID
  let channel = await client.channels.fetch(channelId);

  // Check if the channel is a text channel (or news channel) where threads can be created
  if (channel && channel instanceof TextChannel) {
    channel = channel as TextChannel;
    // Create a new thread in the channel
    const thread = await channel.threads.create({
      name: threadName,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
      reason: "Needed a separate thread for a topic",
      type: privateThread
        ? ChannelType.PrivateThread
        : ChannelType.PublicThread,
    });
    return thread;
  } else {
    console.log("Channel does not support threads or channel not found.");
  }
}

export async function sendToThread(
  thread: ThreadChannel,
  outputMessage: string,
  {
    components = [],
  }: {
    components?: ActionRowBuilder<ButtonBuilder>[];
  } = {}
) {
  // If the response is longer than 2000 characters, split it into chunks
  // const continuationMessage = "\n...Continued in next message...";
  const continuationMessage = "";
  const chunks = _chunkMessage(outputMessage, continuationMessage);

  await _sendChunks(thread, chunks, continuationMessage, components);
}

export async function createPost(
  client: Client,
  channelId: string,
  postTitle: string,
  message: string,
  embed: APIEmbed | undefined = undefined
) {
  // Fetch the channel by ID
  let channel = await client.channels.fetch(channelId);

  // Check if the channel is a text channel (or news channel) where threads can be created
  if (channel && channel instanceof ForumChannel) {
    channel = channel as ForumChannel;

    // Chunk the message if it's too long
    const chunks = _chunkMessage(message);

    // Create a new thread in the channel
    const thread = await channel.threads.create({
      name: postTitle,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
      message: {
        content: embed ? "" : chunks[0], // If there's an embed, start with an empty string
        embeds: embed ? [embed] : [],
      },
    });

    // Send the remaining chunks if there's an embed, otherwise start from the second chunk
    _sendChunks(thread, embed ? chunks : chunks.slice(1));
    return thread;
  } else {
    throw new Error("Channel does not support threads or channel not found.");
  }
}

function _chunkMessage(message: string, continuationMessage: string = "") {
  const chunks = [];
  while (message.length > 2000) {
    let splitIndex = message
      .substring(0, 2000 - continuationMessage.length)
      .lastIndexOf("\n");
    if (splitIndex === -1) {
      // No line break found
      splitIndex = 2000 - continuationMessage.length;
    }
    chunks.push(message.substring(0, splitIndex));
    message = message.substring(splitIndex);
  }
  chunks.push(message); // Append the last chunk
  return chunks;
}

async function _sendChunks(
  thread: ThreadChannel,
  chunks: string[],
  continuationMessage: string = "",
  components?: ActionRowBuilder<ButtonBuilder>[]
) {
  for (let i = 0; i < chunks.length; i++) {
    let messageOptions: {
      content: string;
      components?: ActionRowBuilder<ButtonBuilder>[];
    } = { content: chunks[i] };

    // Add components if this is the last chunk
    if (i === chunks.length - 1 && components) {
      messageOptions = { ...messageOptions, components };
    }

    if (i !== chunks.length - 1) {
      messageOptions.content += continuationMessage;
    }
    await thread.send(messageOptions);
  }
}

export async function pinataSDK() {
  if (!pinataJwt) {
    throw new Error("Pinata JWT key is not set in environment variables.");
  }

  const pinata = new PinataSDK({
    pinataJwt: `${pinataJwt}`,
    pinataGateway: `${pinataGateway}`,
  });

  return pinata;
}
