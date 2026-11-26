/* eslint-disable unicorn/max-nested-calls */

import {
  mergeClassNames,
  VirtualDomElements,
} from '@lvce-editor/virtual-dom-worker'
import type { CardAttachment, CardDetails } from '../BoardView/CardDetails.ts'
import type { TrelloCard, TrelloList } from '../BoardView/Trello.ts'
import { renderCardLoading } from '../BoardView/RenderCardLoading.ts'
import * as Dom from '../VirtualDom/VirtualDom.ts'

const primaryButtonClass = mergeClassNames('BoardButton', 'BoardPrimaryButton')
const descriptionInputClass = mergeClassNames(
  'BoardInput',
  'BoardDescriptionInput',
)
const titleInputClass = mergeClassNames('BoardInput', 'BoardDialogTitleInput')
const cardActionMenuClass = mergeClassNames(
  'BoardOverflowMenu',
  'BoardCardActionMenu',
)
const commentInputClass = mergeClassNames('BoardInput', 'BoardCommentInput')

export interface ImagePreview {
  readonly name: string
  readonly src: string
  readonly trigger: string
}

export interface CardDetailState {
  readonly cardAction?: 'archive' | 'copy' | 'move' | 'upload' | undefined
  readonly cardActionError?: string | undefined
  readonly cardActionMessage?: string | undefined
  readonly cardActionPanel?: 'actions' | 'move' | undefined
  readonly commentDraft?: string | undefined
  readonly commentError?: string | undefined
  readonly descriptionError?: string | undefined
  readonly descriptionRendering?: boolean
  readonly details?: CardDetails | undefined
  readonly detailsError?: string | undefined
  readonly detailsLoading?: boolean
  readonly editDesc?: string
  readonly editDescription?: boolean
  readonly editError?: string | undefined
  readonly editingCard?: TrelloCard | undefined
  readonly editingTitle?: boolean
  readonly editName?: string
  readonly imagePreview?: ImagePreview | undefined
  readonly lists: readonly TrelloList[]
  readonly postingComment?: boolean
  readonly renderedDescription?: Dom.Node | undefined
  readonly renderedDescriptionText?: string | undefined
  readonly savingCard?: boolean
}

const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'always' })
const activityTimeUnits = [
  ['year', 365 * 24 * 60],
  ['month', 30 * 24 * 60],
  ['week', 7 * 24 * 60],
  ['day', 24 * 60],
  ['hour', 60],
  ['minute', 1],
] as const

const renderActivityDate = (value: string, now: number): Dom.Node => {
  const date = new Date(value)
  const minutes = (date.getTime() - now) / 60_000
  const unit = activityTimeUnits.find(([, size]) => Math.abs(minutes) >= size)
  const fallback = Number.isNaN(minutes) ? value : 'Just now'
  const label = unit
    ? relativeTime.format(Math.trunc(minutes / unit[1]), unit[0])
    : fallback
  return Dom.node(
    VirtualDomElements.Span,
    {
      className: 'BoardActivityDate',
      title: Number.isNaN(minutes) ? value : date.toLocaleString(),
    },
    [Dom.textNode(label)],
  )
}

const cardActionBlocksTextInput = (
  action: CardDetailState['cardAction'],
): boolean => action !== undefined && action !== 'upload'

const renderCommentComposer = (state: CardDetailState): Dom.Node => {
  const {
    cardAction,
    commentDraft = '',
    commentError,
    detailsError,
    detailsLoading,
    postingComment,
    savingCard,
  } = state
  return Dom.form('board-post-comment', 'BoardCommentComposer', [
    Dom.node(VirtualDomElements.TextArea, {
      ariaLabel: 'Write a comment',
      className: commentInputClass,
      disabled: Boolean(
        postingComment || cardActionBlocksTextInput(cardAction),
      ),
      name: 'board-comment-text',
      onInput: 'handleInput',
      placeholder: 'Write a comment…',
      value: commentDraft,
    }),
    Dom.node(
      VirtualDomElements.Button,
      {
        buttonType: 'submit',
        className: primaryButtonClass,
        disabled: Boolean(
          postingComment ||
          cardAction ||
          savingCard ||
          detailsLoading ||
          detailsError ||
          !commentDraft.trim(),
        ),
      },
      [Dom.textNode(postingComment ? 'Posting…' : 'Post comment')],
    ),
    ...(commentError
      ? [
          Dom.node(
            VirtualDomElements.Div,
            { className: 'BoardDialogError', role: 'alert' },
            [Dom.textNode(commentError)],
          ),
        ]
      : []),
  ])
}

const renderActivity = (state: CardDetailState): Dom.Node => {
  const { details, detailsError } = state
  const now = Date.now()
  const emptyActivity = detailsError
    ? []
    : [
        Dom.div('BoardDetailEmpty', [
          Dom.textNode('No comments or activity yet'),
        ]),
      ]
  return Dom.node(
    VirtualDomElements.Section,
    {
      ariaLabel: 'Comments and activity',
      className: 'BoardDialogActivity',
    },
    [
      Dom.heading(3, 'BoardDetailHeading', 'Comments and activity'),
      ...(details ? [renderCommentComposer(state)] : []),
      ...(detailsError
        ? [
            Dom.node(
              VirtualDomElements.Div,
              { className: 'BoardDetailsError', role: 'alert' },
              [
                Dom.textNode(detailsError),
                Dom.button(
                  'board-card-details-retry',
                  'Try again',
                  'BoardButton',
                ),
              ],
            ),
          ]
        : []),
      ...(details?.activities.length
        ? details.activities.map((activity) =>
            Dom.div('BoardActivity', [
              Dom.div('BoardActivityAuthor', [Dom.textNode(activity.author)]),
              Dom.div('BoardActivityText', [Dom.textNode(activity.text)]),
              renderActivityDate(activity.date, now),
            ]),
          )
        : emptyActivity),
    ],
  )
}

const renderDescriptionPreview = (state: CardDetailState): Dom.Node => {
  const {
    descriptionError,
    descriptionRendering,
    details,
    detailsError,
    editDesc,
    renderedDescription,
    renderedDescriptionText,
  } = state
  if (detailsError && !details)
    return Dom.div('BoardDetailEmpty', [
      Dom.textNode('Description unavailable'),
    ])
  if (!editDesc)
    return Dom.div('BoardDetailEmpty', [Dom.textNode('No description')])
  if (renderedDescriptionText === editDesc && renderedDescription)
    return renderedDescription.flatMap((node, index) => {
      if (node.type !== VirtualDomElements.Img) return [node]
      return Dom.node(
        VirtualDomElements.Button,
        {
          ariaLabel: `Preview ${node.alt || 'description image'}`,
          buttonType: 'button',
          className: 'BoardDescriptionImageTrigger',
          name: `board-description-image:${index}`,
          onClick: 'handleClick',
          style: node.style,
        },
        [[{ ...node, style: '' }]],
      )
    })
  if (descriptionRendering)
    return Dom.div('BoardDescriptionStatus', [
      Dom.textNode('Rendering preview…'),
    ])
  if (!descriptionError)
    return Dom.div('BoardDescriptionStatus', [
      Dom.textNode('Preparing preview…'),
    ])
  return Dom.div('BoardDescriptionStatus', [
    Dom.textNode(descriptionError),
    Dom.button('board-description-retry', 'Try again', 'BoardButton'),
  ])
}

const renderCardActions = (
  state: Readonly<CardDetailState>,
  card: Readonly<TrelloCard>,
): Dom.Node => {
  const {
    cardAction,
    cardActionPanel,
    detailsLoading,
    lists,
    postingComment,
    savingCard,
  } = state
  const destinations = lists.filter(({ id }) => id !== card.idList)
  const moving = cardActionPanel === 'move'
  return Dom.div('BoardOverflow', [
    Dom.button('board-card-actions', '', 'BoardButton BoardCardOptionsButton', {
      ariaExpanded: Boolean(cardActionPanel),
      ariaLabel: 'More card actions',
      disabled: Boolean(
        cardAction || detailsLoading || postingComment || savingCard,
      ),
    }),
    ...(cardActionPanel
      ? [
          Dom.node(
            VirtualDomElements.Div,
            {
              ariaLabel: 'Card actions',
              className: cardActionMenuClass,
              role: 'group',
            },
            [
              Dom.button('board-card-move', 'Move to list', 'BoardButton', {
                ariaExpanded: moving,
                disabled: destinations.length === 0,
              }),
              ...(moving
                ? destinations.map(({ id, name }) =>
                    Dom.button(
                      `board-card-move:${id}`,
                      name,
                      'BoardButton BoardCardDestination',
                    ),
                  )
                : []),
              Dom.button(
                'board-card-copy-link',
                'Copy card link',
                'BoardButton',
              ),
              Dom.button('board-card-archive', 'Archive card', 'BoardButton'),
            ],
          ),
        ]
      : []),
  ])
}

const renderCardActionFeedback = (
  state: Readonly<CardDetailState>,
): readonly Dom.Node[] => {
  const { cardAction, cardActionError, cardActionMessage } = state
  if (cardActionError) {
    return [
      Dom.node(
        VirtualDomElements.Div,
        { className: 'BoardDialogError', role: 'alert' },
        [Dom.textNode(cardActionError)],
      ),
    ]
  }
  const progress = {
    archive: 'Archiving…',
    copy: '',
    move: 'Moving…',
    upload: 'Uploading images…',
  }
  const message = cardActionMessage || (cardAction && progress[cardAction])
  return message
    ? [
        Dom.node(
          VirtualDomElements.Div,
          { className: 'BoardActivityDate', role: 'status' },
          [Dom.textNode(message)],
        ),
      ]
    : []
}

const renderAttachment = (
  attachment: CardAttachment,
  index: number,
): Dom.Node =>
  Dom.div('BoardAttachment', [
    ...(attachment.previewSrc
      ? [
          Dom.node(
            VirtualDomElements.Button,
            {
              ariaLabel: `Preview ${attachment.name}`,
              buttonType: 'button',
              className: 'BoardAttachmentImageTrigger',
              name: `board-attachment-image:${index}`,
              onClick: 'handleClick',
            },
            [
              Dom.node(VirtualDomElements.Img, {
                alt: '',
                className: 'BoardAttachmentPreview',
                src: attachment.previewSrc,
              }),
            ],
          ),
        ]
      : []),
    Dom.link(attachment.url, attachment.name, 'BoardAttachmentLink'),
  ])

const renderImagePreview = ({ name, src }: ImagePreview): Dom.Node =>
  Dom.node(
    VirtualDomElements.Div,
    {
      ariaLabel: 'Image preview',
      ariaModal: true,
      className: 'BoardImagePreviewOverlay',
      onClick: 'handleDialogOverlayClick',
      onKeyDown: 'handleDialogKeyDown',
      role: 'dialog',
    },
    [
      Dom.div('BoardImagePreviewFrame', [
        Dom.button('board-image-preview-close', '', 'BoardDialogClose', {
          ariaLabel: 'Close image preview',
        }),
        Dom.node(VirtualDomElements.Img, {
          alt: name,
          className: 'BoardImagePreviewContent',
          src,
        }),
        Dom.div('BoardImagePreviewCaption', [Dom.textNode(name)]),
      ]),
    ],
  )

export const renderCardDialog = (
  state: CardDetailState,
): Dom.Node | undefined => {
  const {
    cardAction,
    details,
    detailsError,
    detailsLoading,
    editDesc,
    editDescription,
    editError,
    editingCard,
    editName,
    imagePreview,
    lists,
    postingComment,
    savingCard,
  } = state
  if (!editingCard) return undefined
  if (detailsLoading && !details) return renderCardLoading()
  const detailsUnavailable = Boolean(
    detailsError || detailsLoading || postingComment,
  )
  const editingDisabled = detailsUnavailable || Boolean(cardAction)
  const inputsDisabled = cardActionBlocksTextInput(cardAction)
  const title = editName ?? editingCard.name
  const status =
    lists.find((list) => list.id === editingCard.idList)?.name || 'Unknown list'
  const cardDialog = Dom.node(
    VirtualDomElements.Div,
    {
      ariaHidden: Boolean(imagePreview),
      ariaLabel: 'Card details',
      ariaModal: true,
      className: 'BoardDialogOverlay',
      onClick: 'handleDialogOverlayClick',
      onKeyDown: 'handleDialogKeyDown',
      onPaste: 'handleCardPaste',
      role: 'dialog',
      tabIndex: -1,
    },
    [
      Dom.div('BoardDialog', [
        Dom.div('BoardDialogHeader', [
          Dom.node(
            VirtualDomElements.Span,
            { ariaLabel: `Status: ${status}`, className: 'BoardCardStatus' },
            [Dom.textNode(status)],
          ),
          Dom.div('BoardDialogControls', [
            renderCardActions(state, editingCard),
            Dom.button('board-card-cancel', '', 'BoardDialogClose', {
              ariaLabel: 'Close card',
              disabled: Boolean(postingComment || cardAction),
            }),
          ]),
        ]),
        Dom.div('BoardDialogBody', [
          Dom.div('BoardDialogMain', [
            // Keep the following form fields in place as feedback appears and disappears.
            Dom.div('BoardCardActionFeedback', renderCardActionFeedback(state)),
            Dom.node(
              VirtualDomElements.H2,
              { ariaLabel: title, className: 'BoardDialogTitle' },
              [
                Dom.node(VirtualDomElements.Input, {
                  ariaLabel: 'Title',
                  className: titleInputClass,
                  disabled: detailsUnavailable || inputsDisabled,
                  inputType: 'text',
                  name: 'edit-card-name',
                  onBlur: 'handleBlur',
                  onInput: 'handleInput',
                  value: title,
                }),
              ],
            ),
            Dom.node(
              VirtualDomElements.Section,
              {
                ariaLabel: 'Description',
                className: 'BoardDescriptionSection',
              },
              [
                Dom.div('BoardDescriptionHeader', [
                  Dom.heading(3, 'BoardDetailHeading', 'Description'),
                  Dom.node(VirtualDomElements.Input, {
                    ariaLabel: editDescription ? 'Preview' : 'Edit',
                    className: 'BoardButton',
                    ...(editingDisabled && { disabled: true }),
                    inputType: 'button',
                    name: 'board-description-edit',
                    onClick: 'handleClick',
                    value: editDescription ? 'Preview' : 'Edit',
                  }),
                ]),
                ...(editDescription
                  ? [
                      Dom.node(
                        VirtualDomElements.Label,
                        { className: 'BoardField' },
                        [
                          Dom.textNode('Markdown source'),
                          Dom.node(VirtualDomElements.TextArea, {
                            ariaLabel: 'Markdown source',
                            className: descriptionInputClass,
                            disabled: inputsDisabled,
                            name: 'edit-card-desc',
                            onInput: 'handleInput',
                            value: editDesc || '',
                          }),
                        ],
                      ),
                    ]
                  : [renderDescriptionPreview(state)]),
              ],
            ),
            Dom.node(
              VirtualDomElements.Section,
              { ariaLabel: 'Attachments', className: 'BoardAttachments' },
              [
                Dom.heading(3, 'BoardDetailHeading', 'Attachments'),
                ...(details?.attachments.length
                  ? details.attachments.map(renderAttachment)
                  : [
                      Dom.div('BoardDetailEmpty', [
                        Dom.textNode(
                          detailsError && !details
                            ? 'Attachments unavailable'
                            : 'No attachments',
                        ),
                      ]),
                    ]),
              ],
            ),
            ...(editError
              ? [
                  Dom.node(
                    VirtualDomElements.Div,
                    { className: 'BoardDialogError', role: 'alert' },
                    [
                      Dom.textNode(editError),
                      Dom.button(
                        'board-card-save-retry',
                        'Try again',
                        'BoardButton',
                      ),
                    ],
                  ),
                ]
              : []),
            ...(savingCard
              ? [
                  Dom.node(
                    VirtualDomElements.Div,
                    { className: 'BoardActivityDate', role: 'status' },
                    [Dom.textNode('Saving…')],
                  ),
                ]
              : []),
          ]),
          renderActivity(state),
        ]),
      ]),
    ],
  )
  return Dom.div('BoardCardDialogs', [
    cardDialog,
    ...(imagePreview ? [renderImagePreview(imagePreview)] : []),
  ])
}
