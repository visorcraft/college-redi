import { z } from 'zod';

export const SetupBodySchema = z.object({ password: z.string().min(8, 'Use at least 8 characters.') });
export const LoginBodySchema = z.object({ password: z.string().min(1, 'Password is required.') });
