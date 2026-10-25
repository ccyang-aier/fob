import { z } from 'zod';
import { richContentUrl } from '../rich-content';

export const linkPreviewInputSchema = z.object({
  source: z.enum(['local', 'server']),
  url: z.string().max(4096).refine(value => richContentUrl(value) !== null),
});
export const linkPreviewSchema = z.object({
  url: z.string().max(4096),
  title: z.string().max(500),
  description: z.string().max(2000),
  image: z.string().max(4096),
  siteName: z.string().max(200),
});
export type LinkPreview = z.infer<typeof linkPreviewSchema>;
