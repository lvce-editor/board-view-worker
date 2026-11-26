import type { ViewEvent } from '@lvce-editor/api'
import type {
  CardAttachment,
  CardActivity,
  CardDetails,
} from '../BoardView/CardDetails.ts'
import type { TrelloCard, TrelloList } from '../BoardView/Trello.ts'
import type { Node } from '../VirtualDom/VirtualDom.ts'

export interface CardDetailFocus {
  readonly focusCardActions: boolean
  readonly focusComment: boolean
  readonly focusDescription: boolean
  readonly focusEditor: boolean
  readonly focusImagePreview: boolean
}

export interface CardDetailFrame {
  readonly busy: boolean
  readonly dialog: Node | undefined
  readonly focus: CardDetailFocus
  readonly imagePreviewFocus: string | undefined
  readonly saving: boolean
}

export type CardDetailAction =
  | {
      readonly type: 'open'
      readonly card: TrelloCard
      readonly lists: readonly TrelloList[]
      readonly focus: CardDetailFocus
    }
  | {
      readonly type: 'refresh'
      readonly card: TrelloCard
      readonly lists: readonly TrelloList[]
      readonly descriptionChanged: boolean
    }
  | { readonly type: 'cached'; readonly details: CardDetails }
  | { readonly type: 'event'; readonly event: ViewEvent }
  | {
      readonly type: 'key'
      readonly key: unknown
      readonly targetName: unknown
      readonly ctrlKey: unknown
      readonly isComposing: unknown
    }
  | {
      readonly type: 'paste'
      readonly files: readonly File[]
      readonly targetName: unknown
      readonly selectionStart: unknown
      readonly selectionEnd: unknown
    }
  | { readonly type: 'overlay' }
  | { readonly type: 'dispose' }

export interface CardDetailHost {
  readonly addAttachment: (file: File) => Promise<CardAttachment>
  readonly addComment: (text: string) => Promise<CardActivity>
  readonly applyChange: (changes: Partial<TrelloCard> | null) => void
  readonly archiveCard: () => Promise<void>
  readonly close: (archived?: boolean) => void
  readonly copyCardLink: () => Promise<void>
  readonly loadAttachmentImage: (url: string) => Promise<string | undefined>
  readonly loadCard: () => Promise<CardDetails | undefined>
  readonly loadDescriptionImages: (markdown: Node) => Promise<Node>
  readonly moveCard: (listId: string) => Promise<void>
  readonly publish: (frame: CardDetailFrame) => void
  readonly renderDescriptionMarkdown: (text: string) => Promise<Node>
  readonly updateCard: (name: string, desc: string) => Promise<TrelloCard>
}

export type DispatchCardDetail = (
  action: CardDetailAction,
) => void | Promise<void>
export type ConnectCardDetail = (host: CardDetailHost) => DispatchCardDetail

export type CardDetailHostMethod = keyof CardDetailHost
