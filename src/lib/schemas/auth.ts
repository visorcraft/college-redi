import { z } from 'zod';

export const SetupBodySchema = z.object({
  password: z.string().min(8, 'Use at least 8 characters.'),
  setupToken: z.string().min(1, 'Setup token is required.').max(200),
});
export const LoginBodySchema = z.object({ password: z.string().min(1, 'Password is required.') });
