import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { initChatModel } from 'langchain/chat_models/universal';

let model: BaseChatModel | undefined;

export const getModel = async (modelName: string): Promise<BaseChatModel> => {
    if (!model) {
        model = await initChatModel(modelName);
    }
    return model;
}