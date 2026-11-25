import type { ViewEvent } from '@lvce-editor/api'
import type { CardAttachment, CardDetails } from '../BoardView/CardDetails.ts'
import type { TrelloCard } from '../BoardView/Trello.ts'
import type {
  CardDetailAction,
  CardDetailFocus,
  ConnectCardDetail,
} from './CardDetailProtocol.ts'
import { TrelloError } from '../BoardView/TrelloError.ts'
import { renderCardDialog, type CardDetailState } from './RenderCardDetail.ts'

const markdownImageAltCharacters = /[[\]\\\r\n]/gu

interface DescriptionSelection {
  readonly end: number
  readonly start: number
}

const insertDescriptionImage = (
  text: string,
  { end, start }: DescriptionSelection,
  attachment: CardAttachment,
): { readonly text: string; readonly selection: DescriptionSelection } => {
  const before = text.slice(0, start)
  const after = text.slice(end)
  const alt =
    attachment.name.replaceAll(markdownImageAltCharacters, '') || 'Image'
  const url = attachment.url.replaceAll('(', '%28').replaceAll(')', '%29')
  const prefix = before && !before.endsWith('\n\n') ? '\n\n' : ''
  const suffix = after && !after.startsWith('\n\n') ? '\n\n' : ''
  const inserted = `${before}${prefix}![${alt}](${url})`
  return {
    selection: { end: inserted.length, start: inserted.length },
    text: inserted + suffix + after,
  }
}

export const createCardDetail: ConnectCardDetail = (host) => {
  let state: CardDetailState = { lists: [] }
  let publishedState: CardDetailState | undefined
  let disposed = false
  let descriptionGeneration = 0
  let pendingDescriptionKey: string | undefined
  let attachmentUpload: Promise<void> | undefined
  let cardSave: Promise<boolean> | undefined
  let focus: CardDetailFocus
  const notify = (): void => {
    if (disposed || publishedState === state) return
    publishedState = state
    const {
      cardAction,
      commentDraft,
      detailsLoading,
      editDescription,
      editError,
      editingTitle,
      postingComment,
      savingCard,
    } = state
    host.publish({
      busy: Boolean(
        cardAction ||
        commentDraft ||
        detailsLoading ||
        editDescription ||
        editError ||
        editingTitle ||
        postingComment ||
        savingCard,
      ),
      dialog: renderCardDialog(state),
      editingTitle: Boolean(editingTitle),
      focus,
      saving: Boolean(savingCard),
    })
  }
  const prepareDescription = async (
    text: string,
  ): Promise<
    Pick<
      CardDetailState,
      'descriptionError' | 'renderedDescription' | 'renderedDescriptionText'
    >
  > => {
    if (!text) return {}
    try {
      const markdown = await host.renderDescriptionMarkdown(text)
      return {
        renderedDescription: await host.loadDescriptionImages(markdown),
        renderedDescriptionText: text,
      }
    } catch {
      return { descriptionError: 'Unable to render the description preview.' }
    }
  }
  const renderDescription = async (text: string): Promise<void> => {
    const {
      editDescription,
      editingCard,
      renderedDescription,
      renderedDescriptionText,
    } = state
    if (!text || !editingCard || editDescription || disposed) return
    if (renderedDescriptionText === text && renderedDescription) return
    const key = `${editingCard.id}\0${text}`
    if (pendingDescriptionKey === key) return
    const requestGeneration = ++descriptionGeneration
    const cardId = editingCard.id
    pendingDescriptionKey = key
    state = {
      ...state,
      descriptionError: undefined,
      descriptionRendering: true,
      renderedDescription: undefined,
      renderedDescriptionText: undefined,
    }
    notify()
    const preview = await prepareDescription(text)
    const {
      editDesc: currentEditDesc,
      editDescription: isEditingDescription,
      editingCard: currentEditingCard,
    } = state
    if (requestGeneration !== descriptionGeneration) return
    pendingDescriptionKey = undefined
    if (
      disposed ||
      currentEditingCard?.id !== cardId ||
      currentEditDesc !== text ||
      isEditingDescription
    )
      return
    state = { ...state, ...preview, descriptionRendering: false }
    notify()
  }
  const persistCard = async (
    card: TrelloCard,
    name: string,
    desc: string,
  ): Promise<boolean> => {
    state = { ...state, editError: undefined, savingCard: true }
    notify()
    try {
      const updated = await host.updateCard(name, desc)
      if (disposed) return false
      const { details } = state
      const attachmentCount = Math.max(
        updated.attachmentCount ?? 0,
        details?.attachments.length ?? 0,
      )
      const changes = { ...updated, attachmentCount }
      const updatedCard = { ...card, ...changes }
      host.applyChange(changes)
      state = {
        ...state,
        ...(details && { details: { ...details, desc } }),
        editingCard: updatedCard,
        savingCard: false,
      }
      notify()
      return true
    } catch (error) {
      if (disposed) return false
      state = {
        ...state,
        editError:
          error instanceof TrelloError
            ? error.details.message
            : 'Unable to save this card. Check your connection and try again.',
        savingCard: false,
      }
      notify()
      return false
    }
  }
  const saveCard = async (): Promise<boolean> => {
    while (attachmentUpload || cardSave) {
      if (attachmentUpload) await attachmentUpload
      else if (cardSave && !(await cardSave)) return false
      if (disposed) return false
    }
    const {
      details,
      detailsError,
      detailsLoading,
      editDesc = '',
      editingCard,
      editName,
      postingComment,
    } = state
    if (!editingCard || detailsError || detailsLoading) return true
    if (postingComment) return false
    const name = editName?.trim() || editingCard.name
    if (
      name === editingCard.name &&
      editDesc === (details?.desc ?? editingCard.desc ?? '')
    )
      return true
    const save = persistCard(editingCard, name, editDesc)
    cardSave = save
    try {
      return await save
    } finally {
      if (cardSave === save) cardSave = undefined
    }
  }
  const finishTitleEdit = (): void => {
    const { editingCard, editingTitle, editName } = state
    if (!editingCard || !editingTitle) return
    state = {
      ...state,
      editingTitle: false,
      editName: editName?.trim() || editingCard.name,
    }
    void saveCard()
    notify()
  }
  const dismissEditor = async (): Promise<void> => {
    const { cardAction, editError, postingComment: alreadyPosting } = state
    if (alreadyPosting || cardAction) return
    const canClose = Boolean(editError) || (await saveCard())
    const { editingCard, postingComment } = state
    if (!canClose || disposed || !editingCard || postingComment) return
    host.close()
  }
  const closeCardActions = (): void => {
    state = { ...state, cardActionPanel: undefined }
    focus = { ...focus, focusCardActions: !focus.focusCardActions }
  }
  const runCardAction = async (
    action: NonNullable<CardDetailState['cardAction']>,
    perform: (card: TrelloCard) => Promise<void>,
  ): Promise<void> => {
    const {
      cardAction,
      detailsLoading,
      editingCard,
      postingComment,
      savingCard,
    } = state
    if (
      !editingCard ||
      cardAction ||
      detailsLoading ||
      postingComment ||
      savingCard
    )
      return
    state = {
      ...state,
      cardAction: action,
      cardActionError: undefined,
      cardActionMessage: undefined,
      cardActionPanel: undefined,
    }
    notify()
    try {
      await perform(editingCard)
    } catch (error) {
      if (!disposed) {
        const failureMessage = {
          archive:
            'Unable to archive this card. Refresh the board to check its status before trying again.',
          copy: 'Unable to copy the card link.',
          move: 'Unable to move this card. Refresh the board to check its list before trying again.',
          upload:
            'Unable to confirm the image upload. Reopen the card to check its attachments before retrying.',
        }
        state = {
          ...state,
          cardActionError:
            error instanceof TrelloError
              ? error.details.message
              : failureMessage[action],
        }
      }
    } finally {
      if (!disposed) {
        state = { ...state, cardAction: undefined }
        if (action !== 'upload')
          focus = { ...focus, focusCardActions: !focus.focusCardActions }
        notify()
      }
    }
  }
  const uploadImages = async (
    files: readonly File[],
    selection?: DescriptionSelection,
  ): Promise<void> => {
    const { details, detailsError, editDesc = '' } = state
    if (attachmentUpload || !details || detailsError) return
    let draft = editDesc
    let currentSelection = selection
    const upload = runCardAction('upload', async (card) => {
      for (const file of files) {
        const attachment = await host.addAttachment(file)
        const { details, editDesc: current = '', editingCard } = state
        if (disposed || !details || editingCard?.id !== card.id) return
        const attachmentCount =
          Math.max(
            editingCard.attachmentCount ?? 0,
            details.attachments.length,
          ) + 1
        if (currentSelection) {
          // Preserve typing during the upload if the captured selection is stale.
          const range =
            current === draft
              ? currentSelection
              : { end: current.length, start: current.length }
          const insert = insertDescriptionImage(current, range, attachment)
          draft = insert.text
          currentSelection = insert.selection
        }
        host.applyChange({ attachmentCount })
        state = {
          ...state,
          details: {
            ...details,
            attachments: [...details.attachments, attachment],
          },
          editingCard: { ...editingCard, attachmentCount },
          ...(selection && { editDesc: draft, editError: undefined }),
        }
        notify()
      }
    })
    attachmentUpload = upload
    try {
      await upload
    } finally {
      if (attachmentUpload === upload) attachmentUpload = undefined
    }
  }
  const copyCardLink = (): Promise<void> =>
    runCardAction('copy', async () => {
      await host.copyCardLink()
      if (!disposed)
        state = { ...state, cardActionMessage: 'Card link copied.' }
    })
  const changeCardPlacement = (listId?: string): Promise<void> =>
    runCardAction(listId ? 'move' : 'archive', async () => {
      if (!(await saveCard()) || disposed) return
      if (listId) await host.moveCard(listId)
      else await host.archiveCard()
      const { editingCard } = state
      if (disposed || !editingCard) return
      host.applyChange(listId ? { idList: listId } : null)
      if (listId)
        state = { ...state, editingCard: { ...editingCard, idList: listId } }
      else host.close(true)
    })
  const moveCardToList = async (listId: string): Promise<void> => {
    const { editingCard, lists } = state
    if (
      listId !== editingCard?.idList &&
      lists.some(({ id }) => id === listId)
    ) {
      await changeCardPlacement(listId)
    }
  }
  const showDetails = (
    details: CardDetails,
    loading: boolean,
    preview?: Awaited<ReturnType<typeof prepareDescription>>,
  ): void => {
    const { details: previousDetails, editDesc } = state
    const firstDetails = !previousDetails
    const descriptionChanged = firstDetails || editDesc !== details.desc
    if (descriptionChanged) {
      descriptionGeneration++
      pendingDescriptionKey = undefined
    }
    state = {
      ...state,
      details,
      detailsLoading: loading,
      editDesc: details.desc,
      ...(descriptionChanged && {
        descriptionError: undefined,
        descriptionRendering: false,
        renderedDescription: undefined,
        renderedDescriptionText: undefined,
        ...preview,
      }),
    }
    if (firstDetails) focus = { ...focus, focusEditor: !focus.focusEditor }
    if (descriptionChanged && !preview && details.desc) {
      void renderDescription(details.desc)
    } else {
      notify()
    }
  }
  const postComment = async (): Promise<void> => {
    const {
      cardAction,
      commentDraft,
      details,
      detailsError,
      detailsLoading,
      editingCard,
      postingComment,
      savingCard,
    } = state
    const text = commentDraft?.trim()
    if (
      !text ||
      cardAction ||
      !editingCard ||
      !details ||
      detailsError ||
      detailsLoading ||
      postingComment ||
      savingCard
    )
      return

    state = { ...state, commentError: undefined, postingComment: true }
    notify()
    try {
      const activity = await host.addComment(text)
      if (disposed) return
      const commentCount = (editingCard.commentCount ?? 0) + 1
      host.applyChange({ commentCount })
      state = {
        ...state,
        commentDraft: '',
        details: { ...details, activities: [activity, ...details.activities] },
        editingCard: { ...editingCard, commentCount },
        postingComment: false,
      }
    } catch (error) {
      if (disposed) return
      state = {
        ...state,
        commentError:
          error instanceof TrelloError
            ? error.details.message
            : 'Unable to confirm the comment. Check the activity before retrying.',
        postingComment: false,
      }
    }
    focus = { ...focus, focusComment: !focus.focusComment }
    notify()
  }
  const loadCardDetails = async (): Promise<void> => {
    const {
      cardAction,
      detailsLoading,
      editingCard,
      postingComment,
      savingCard,
    } = state
    if (
      !editingCard ||
      savingCard ||
      detailsLoading ||
      postingComment ||
      cardAction
    )
      return
    state = { ...state, detailsError: undefined, detailsLoading: true }
    try {
      const details = await host.loadCard()
      if (disposed) return
      if (!details) throw new Error('Card details request failed')
      // Keep the existing staged opening on a cold load.
      const { details: previousDetails } = state
      const preview = previousDetails
        ? undefined
        : await prepareDescription(details.desc)
      if (!disposed) showDetails(details, false, preview)
    } catch {
      if (disposed) return
      const { details } = state
      if (!details) focus = { ...focus, focusEditor: !focus.focusEditor }
      state = {
        ...state,
        detailsError: details
          ? 'Unable to refresh card details. Try again.'
          : 'Unable to load card details. Try again.',
        detailsLoading: false,
      }
      notify()
    }
  }
  const handleDescriptionClick = (name: string | undefined): boolean => {
    if (name === 'board-description-edit') {
      const { editDesc, editDescription } = state
      state = { ...state, editDescription: !editDescription }
      if (editDescription) {
        void saveCard()
        void renderDescription(editDesc || '')
      } else {
        focus = { ...focus, focusDescription: !focus.focusDescription }
        descriptionGeneration++
        pendingDescriptionKey = undefined
      }
      return true
    }
    if (name === 'board-description-retry') {
      const { editDesc } = state
      void renderDescription(editDesc || '')
      return true
    }
    return false
  }
  const handleCardActionClick = (name: string | undefined): boolean => {
    const { cardAction, cardActionPanel, editingCard } = state
    if (cardAction) return true
    if (!editingCard) return false
    if (name === 'board-card-actions') {
      state = {
        ...state,
        cardActionPanel: cardActionPanel ? undefined : 'actions',
      }
      return true
    }
    if (!cardActionPanel) return false
    if (name === 'board-card-move') {
      state = {
        ...state,
        cardActionPanel: cardActionPanel === 'move' ? 'actions' : 'move',
      }
      return true
    }
    if (name === 'board-card-archive') {
      void changeCardPlacement()
      return true
    }
    if (name === 'board-card-copy-link') {
      void copyCardLink()
      return true
    }
    if (cardActionPanel === 'move' && name?.startsWith('board-card-move:')) {
      void moveCardToList(name.slice('board-card-move:'.length))
      return true
    }
    return false
  }
  const handleEvent = ({ name, type, value }: Readonly<ViewEvent>): void => {
    const { postingComment } = state
    if (type === 'input' && typeof value === 'string') {
      if (name === 'board-comment-text' && !postingComment)
        state = { ...state, commentDraft: value, commentError: undefined }
      else if (name === 'edit-card-desc') {
        descriptionGeneration++
        pendingDescriptionKey = undefined
        state = { ...state, editDesc: value, editError: undefined }
      } else if (name === 'edit-card-name')
        state = { ...state, editError: undefined, editName: value }
    }
    if (type === 'blur' && name === 'edit-card-name') finishTitleEdit()
    if (type === 'submit' && name === 'board-post-comment') void postComment()
    if (
      type !== 'click' ||
      handleCardActionClick(name) ||
      handleDescriptionClick(name)
    )
      return
    switch (name) {
      case 'board-card-cancel':
        void dismissEditor()
        break
      case 'board-card-details-retry':
        void loadCardDetails()
        break
      case 'board-card-save-retry':
        void saveCard()
        break
      case 'board-card-title-edit':
        state = { ...state, editingTitle: true }
        focus = { ...focus, focusCardTitle: !focus.focusCardTitle }
        break
    }
  }
  const open = ({
    card,
    focus: initialFocus,
    lists,
  }: Extract<CardDetailAction, { readonly type: 'open' }>): void => {
    focus = initialFocus
    state = {
      editDesc: card.desc || '',
      editingCard: card,
      editName: card.name,
      lists,
    }
    void loadCardDetails()
  }
  const refresh = ({
    card,
    descriptionChanged,
    lists,
  }: Extract<CardDetailAction, { readonly type: 'refresh' }>): void => {
    const { details } = state
    state = { ...state, editingCard: card, editName: card.name, lists }
    if (details && descriptionChanged)
      showDetails({ ...details, desc: card.desc }, false)
  }
  const handleKey = ({
    ctrlKey,
    isComposing,
    key,
    targetName,
  }: Extract<CardDetailAction, { readonly type: 'key' }>): void => {
    const { cardActionPanel, editDescription, editingTitle } = state
    if (key === 'Escape') {
      if (cardActionPanel) closeCardActions()
      else void dismissEditor()
    }
    if (key !== 'Enter') return
    if (
      ctrlKey === true &&
      isComposing !== true &&
      targetName === 'edit-card-desc' &&
      editDescription
    ) {
      handleDescriptionClick('board-description-edit')
    } else if (editingTitle) {
      focus = { ...focus, focusCardTitle: !focus.focusCardTitle }
      finishTitleEdit()
    }
  }
  const handlePaste = ({
    files,
    selectionEnd,
    selectionStart,
    targetName,
  }: Extract<CardDetailAction, { readonly type: 'paste' }>): void => {
    const { editDesc = '', editDescription } = state
    const { length } = editDesc
    const selection =
      targetName === 'edit-card-desc' && editDescription
        ? {
            end: typeof selectionEnd === 'number' ? selectionEnd : length,
            start: typeof selectionStart === 'number' ? selectionStart : length,
          }
        : undefined
    void uploadImages(files, selection)
  }
  return (action) => {
    if (disposed) return
    switch (action.type) {
      case 'cached': {
        const { details, detailsLoading } = state
        if (!details && detailsLoading) showDetails(action.details, true)
        break
      }
      case 'dispose':
        disposed = true
        return
      case 'event':
        handleEvent(action.event)
        break
      case 'key':
        handleKey(action)
        break
      case 'open':
        open(action)
        break
      case 'overlay':
        void dismissEditor()
        break
      case 'paste':
        handlePaste(action)
        break
      case 'refresh':
        refresh(action)
        break
    }
    notify()
  }
}
