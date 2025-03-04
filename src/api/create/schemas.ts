import { z } from 'zod';

export const CreateGameRequestSchema = z.object({
  description: z.string().min(1).max(2000),
});

export const CreateGameResponseSchema = z.object({
  gameDescription: z.string(),
});

export type CreateGameRequest = z.infer<typeof CreateGameRequestSchema>;
export type CreateGameResponse = z.infer<typeof CreateGameResponseSchema>;
