import { z } from 'zod';

export const SetupBodySchema = z.object({
  password: z.string().min(8, 'Use at least 8 characters.'),
  setupToken: z.string().min(1).optional(),
});
export const LoginBodySchema = z.object({ password: z.string().min(1, 'Password is required.') });
