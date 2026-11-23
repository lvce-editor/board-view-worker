import { imageMimePattern, trelloImageUrl } from './DescriptionImages.ts'

export interface CardAttachment {
  readonly name: string
  readonly previewSrc?: string
  readonly previewUrl?: string
  readonly url: string
}

export interface CardActivity {
  readonly author: string
  readonly date: string
  readonly text: string
}

export interface CardDetails {
  readonly activities: readonly CardActivity[]
  readonly attachments: readonly CardAttachment[]
  readonly desc: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const selectPreview = (
  attachment: Readonly<Record<string, unknown>>,
  url: string,
): string | undefined => {
  if (Array.isArray(attachment.previews)) {
    const previews = attachment.previews
      .flatMap((preview: unknown) => {
        if (
          !isRecord(preview) ||
          preview.scaled !== true ||
          typeof preview.url !== 'string' ||
          typeof preview.width !== 'number' ||
          !Number.isFinite(preview.width) ||
          preview.width <= 0
        )
          return []
        const source = trelloImageUrl(preview.url)
        return source ? [{ source, width: preview.width } as const] : []
      })
      .toSorted((a, b) => a.width - b.width)
    // Prefer the smallest full-image preview at least as wide as the thumbnail.
    const selected =
      previews.find(({ width }) => width >= 300) ?? previews.at(-1)
    if (selected) return selected.source
  }
  return typeof attachment.mimeType === 'string' &&
    imageMimePattern.test(attachment.mimeType)
    ? trelloImageUrl(url)
    : undefined
}

export const normalizeAttachment = (
  attachment: unknown,
): CardAttachment | undefined => {
  if (
    !isRecord(attachment) ||
    typeof attachment.name !== 'string' ||
    typeof attachment.url !== 'string'
  )
    return undefined
  const url = URL.parse(attachment.url)
  if (url?.protocol !== 'https:') return undefined
  const previewUrl = selectPreview(attachment, url.href)
  return {
    name: attachment.name,
    url: url.href,
    ...(previewUrl && { previewUrl }),
  }
}

const activityText = (
  type: unknown,
  data: Readonly<Record<string, unknown>>,
): string => {
  const { listAfter, text } = data
  if (type === 'commentCard' && typeof text === 'string') return text
  if (type === 'createCard') return 'Created this card'
  if (
    type === 'updateCard' &&
    isRecord(listAfter) &&
    typeof listAfter.name === 'string'
  )
    return `Moved this card to ${listAfter.name}`
  return ''
}

export const normalizeActivity = (
  action: unknown,
): CardActivity | undefined => {
  if (
    !isRecord(action) ||
    !isRecord(action.data) ||
    typeof action.date !== 'string'
  )
    return undefined
  const { data, date, memberCreator, type } = action
  const member = isRecord(memberCreator) ? memberCreator : undefined
  const author =
    typeof member?.fullName === 'string' ? member.fullName : 'Trello member'
  const text = activityText(type, data)
  return text ? { author, date, text } : undefined
}

export const normalizeDetails = (value: unknown): CardDetails => {
  if (
    !isRecord(value) ||
    typeof value.desc !== 'string' ||
    !Array.isArray(value.attachments) ||
    !Array.isArray(value.actions)
  )
    throw new Error('Invalid card details')
  return {
    activities: value.actions.flatMap((action) => {
      const activity = normalizeActivity(action)
      return activity ? [activity] : []
    }),
    attachments: value.attachments.flatMap((item) => {
      const attachment = normalizeAttachment(item)
      return attachment ? [attachment] : []
    }),
    desc: value.desc,
  }
}
