import { z } from 'zod';

export const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

export const sendChatMessageSchema = z.object({
  message: z.string().trim().min(1).max(4000),
});
