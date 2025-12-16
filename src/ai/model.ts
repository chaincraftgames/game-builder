import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { initChatModel } from 'langchain/chat_models/universal';
import { ChatAnthropic } from "@langchain/anthropic";

// Cache models by name AND maxTokens to avoid re-initialization
const modelCache = new Map<string, BaseChatModel>();

export const getModel = async (
    modelName: string, 
    maxTokens?: number
): Promise<BaseChatModel> => {
    // Create cache key that includes maxTokens
    const cacheKey = maxTokens ? `${modelName}:${maxTokens}` : modelName;
    
    if (!modelCache.has(cacheKey)) {
        console.log(`[getModel] Initializing new model: ${modelName}${maxTokens ? ` with maxTokens: ${maxTokens}` : ''}`);
        
        let model: BaseChatModel;
        
        // For Anthropic models, use ChatAnthropic directly with reasonable maxTokens
        // Default 2048 is too low for planning/generation tasks
        // Setting higher doesn't cost more unless model generates more tokens
        if (modelName.startsWith('claude-')) {
            model = new ChatAnthropic({
                model: modelName,
                maxTokens: maxTokens || 8192, // Use provided or default to 8192
                temperature: 1,
            });
        } else {
            model = await initChatModel(modelName);
        }
        
        modelCache.set(cacheKey, model);
    } else {
        console.log(`[getModel] Returning cached model: ${cacheKey}`);
    }
    return modelCache.get(cacheKey)!;
}