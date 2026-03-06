import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { initChatModel } from 'langchain/chat_models/universal';
import { ChatAnthropic } from "@langchain/anthropic";

// Cache models by name AND maxTokens to avoid re-initialization
const modelCache = new Map<string, BaseChatModel>();

/**
 * Whether to route this model through ChatAnthropic.
 * True for claude-* models, or any model when ANTHROPIC_BASE_URL is set
 * (e.g. pointing at Minimax's Anthropic-compatible endpoint).
 */
function useAnthropicClient(modelName: string): boolean {
    return modelName.startsWith('claude-') || !!process.env.ANTHROPIC_BASE_URL;
}

export const getModel = async (
    modelName: string, 
    maxTokens?: number,
    apiKey?: string
): Promise<BaseChatModel> => {
    const baseURL = process.env.ANTHROPIC_BASE_URL;

    // Include baseURL in cache key so switching providers mid-session doesn't
    // return a stale model pointed at the wrong endpoint.
    const cacheKey = [modelName, maxTokens, baseURL].filter(Boolean).join(':');
    
    if (!modelCache.has(cacheKey)) {
        console.log(`[getModel] Initializing new model: ${modelName}${maxTokens ? ` with maxTokens: ${maxTokens}` : ''}${baseURL ? ` via ${baseURL}` : ''}`);
        
        let model: BaseChatModel;
        
        // Use ChatAnthropic for claude-* models, or when ANTHROPIC_BASE_URL is set
        // (e.g. Minimax's Anthropic-compatible endpoint at https://api.minimax.io/anthropic).
        // Default 2048 is too low for planning/generation tasks; higher doesn't
        // cost more unless the model actually generates more tokens.
        if (useAnthropicClient(modelName)) {
            model = new ChatAnthropic({
                model: modelName,
                maxTokens: maxTokens || 8192,
                temperature: 1,
                apiKey: apiKey,
                ...(baseURL && { clientOptions: { baseURL } }),
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