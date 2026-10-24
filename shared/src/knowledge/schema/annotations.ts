import type { AttributeSpec } from '@tiptap/pm/model';
import { z } from 'zod';

export const suggestionMarkNames = ['suggestion_insert', 'suggestion_delete'] as const;
export type SuggestionMarkName = typeof suggestionMarkNames[number];
export const suggestionMetadataSchema = z.strictObject({
  suggestionId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  author: z.string().trim().min(1).max(256),
  createdAt: z.iso.datetime({ offset: true }),
});
export const nodeAnnotationSchema = z.strictObject({
  type: z.enum(suggestionMarkNames),
  attrs: suggestionMetadataSchema,
});
export const nodeAnnotationsSchema = z.array(nodeAnnotationSchema).superRefine((annotations, context) => {
  const keys = annotations.map((annotation) => `${annotation.type}:${annotation.attrs.suggestionId}`);
  if (new Set(keys).size !== keys.length) context.addIssue({ code: 'custom', message: 'Duplicate node annotation' });
});
export type SuggestionMetadata = z.infer<typeof suggestionMetadataSchema>;
export type NodeAnnotation = z.infer<typeof nodeAnnotationSchema>;

/** y-prosemirror persists marks only on text; non-text annotations live in attrs. */
export const nodeAnnotationsAttribute: AttributeSpec = {
  default: null,
  validate(value: unknown) { if (value !== null) nodeAnnotationsSchema.parse(value); },
};
