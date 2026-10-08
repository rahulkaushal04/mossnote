import { z } from 'zod';

/** `PUT /api/phone`: turn access from phones and tablets on or off. */
export const phoneEnabledSchema = z.object({ enabled: z.boolean() }).strict();

export type PhoneEnabled = z.infer<typeof phoneEnabledSchema>;
