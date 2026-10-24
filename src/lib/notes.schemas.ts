import { z } from 'zod'

export const noteColors = ['mint', 'lavender', 'peach', 'sky'] as const
export type NoteColor = (typeof noteColors)[number]

export const encryptedNotePayloadSchema = z.object({
  version: z.literal(1),
  content: z.string(),
  attachments: z.record(z.string(), z.string()).optional(),
  tags: z.array(z.string()),
  color: z.enum(noteColors),
  pinned: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type EncryptedNotePayload = z.infer<typeof encryptedNotePayloadSchema>

export type Note = EncryptedNotePayload & {
  id: string
  path: string
  sha: string
  title: string
  folder: string[]
}

export const noteFiltersSchema = z.object({
  q: z.string().catch('').default(''),
  tag: z.string().catch('all').default('all'),
  sort: z.enum(['updated', 'created', 'title']).catch('updated').default('updated'),
  view: z.enum(['grid', 'list']).catch('grid').default('grid'),
})

export type NoteFilters = z.infer<typeof noteFiltersSchema>
