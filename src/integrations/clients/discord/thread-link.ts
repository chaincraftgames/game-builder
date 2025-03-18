import { ThreadChannel, Message } from "discord.js";

// Define supported link types
export type ThreadLinkType = 'design' | 'simulation' | 'shared';

interface ThreadLinkConfig {
    prefix: string;
    description: string;
    formatMessage: (threadId: string) => string;
  }
  
  const threadLinkConfigs: Record<ThreadLinkType, ThreadLinkConfig> = {
    design: {
      prefix: '🎮 Design',
      description: 'Original game design thread',
      formatMessage: () => '📝 Use "Return to Design" to analyze simulation results and continue design'
    },
    simulation: {
      prefix: '🎲 Simulation',
      description: 'Active simulation thread',
      formatMessage: () => '🎮 Use "Simulate" to test gameplay with AI or other players'
    },
    shared: {
      prefix: '📢 Shared',
      description: 'Shared post thread',
      formatMessage: (threadId: string) => 
        `[View shared post](<https://discord.com/channels/${process.env.CHAINCRAFT_GUILD_ID}/${threadId}>)`
    }
  };

  export async function storeThreadLink(
    thread: ThreadChannel,
    linkedThreadId: string,
    linkType: ThreadLinkType
  ): Promise<void> {
    const config = threadLinkConfigs[linkType];
    // Store both the message and the ID in a format that's readable but not clickable
    const messageContent = `${config.formatMessage(linkedThreadId)}\n||${linkType} thread id: ${linkedThreadId}||`;
    
    const pinnedMessages = await thread.messages.fetchPinned();
    const existingLink = pinnedMessages.find(
      m => m.content.includes(linkedThreadId) && m.author.bot
    );
  
    if (existingLink) {
      await existingLink.edit(messageContent);
    } else {
      const message = await thread.send(messageContent);
      await message.pin();
    }
  }

export async function getLinkedThreadId(
  thread: ThreadChannel,
  linkType: ThreadLinkType
): Promise<string | null> {
  const pinnedMessages = await thread.messages.fetchPinned();
  
  // Find message that matches the specific link type
  const linkMessage = pinnedMessages.find(
    m => m.author.bot && m.content.includes(`${linkType} thread id:`)
  );
  
  if (!linkMessage) return null;

  // Extract thread ID from spoiler tags with link type
  const match = linkMessage.content.match(/\|\|.*?thread id: (\d+)\|\|/);
  return match ? match[1] : null;
}

export async function getLinkedThread(
  thread: ThreadChannel,
  linkType: ThreadLinkType
): Promise<ThreadChannel | null> {
  const threadId = await getLinkedThreadId(thread, linkType);
  if (!threadId) return null;

  try {
    return await thread.client.channels.fetch(threadId) as ThreadChannel;
  } catch (error) {
    console.error(`Failed to fetch ${linkType} thread:`, error);
    return null;
  }
}