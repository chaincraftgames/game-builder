import { listThreadIds } from "#chaincraft/ai/memory/checkpoint-memory.js";

// Map of conversation IDs by graph type
const conversationIds = new Map<string, Set<string>>();
const bootstrappedTypes = new Set<string>();

export async function registerConversationId(graphType: string, conversationId: string): Promise<void> {
    await bootstrapConversationIds(graphType);
    
    const ids = conversationIds.get(graphType);
    if (!ids) {
        conversationIds.set(graphType, new Set([conversationId]));
    } else {
        ids.add(conversationId);
    }
}

export async function getConversationIds(graphType: string): Promise<string[]> {
    await bootstrapConversationIds(graphType);
    return Array.from(conversationIds.get(graphType) || []);
}

export async function isActiveConversation(graphType: string, conversationId: string): Promise<boolean> {
    await bootstrapConversationIds(graphType);
    return conversationIds.get(graphType)?.has(conversationId) ?? false;
}

async function bootstrapConversationIds(graphType: string): Promise<void> {
    if (bootstrappedTypes.has(graphType)) {
        return;
    }

    const threadIds = await listThreadIds(graphType);
    conversationIds.set(graphType, new Set(threadIds));
    bootstrappedTypes.add(graphType);
}