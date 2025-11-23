import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { initChatModel } from 'langchain/chat_models/universal';

// Cache models by name to avoid re-initialization
const modelCache = new Map<string, BaseChatModel>();

export const getModel = async (modelName: string): Promise<BaseChatModel> => {
    if (!modelCache.has(modelName)) {
        console.log(`[getModel] Initializing new model: ${modelName}`);
        const model = await initChatModel(modelName);
        modelCache.set(modelName, model);
    } else {
        console.log(`[getModel] Returning cached model: ${modelName}`);
    }
    return modelCache.get(modelName)!;
}