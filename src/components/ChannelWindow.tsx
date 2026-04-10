import { useState, useEffect, useRef, useMemo } from 'react'
import { useStore, NostrMessage, ChannelReaction, ChannelMedia, parseChannelContent, buildChannelContent } from '../store'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shortPk(pk: string) {
  return pk.length >= 8 ? `${pk.slice(0, 6)}…${pk.slice(-4)}` : pk
}
function formatTime(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
}
function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('ru', { day: 'numeric', month: 'long' })
}

const QUICK_EMOJIS = ['👍', '❤️', '🔥', '😂', '😮', '👎']
const MAX_MEDIA_BYTES = 512 * 1024 // 512 KB

// ─── Context Menu ─────────────────────────────────────────────────────────────

interface CtxMenu {
  x: number; y: number
  msg: NostrMessage
}

function ContextMenu({
  menu, isCreator, onEdit, onDelete, onReact, onReply, onForward, onClose,
}: {
  menu: CtxMenu
  isCreator: boolean
  onEdit: () => void
  onDelete: () => void
  onReact: () => void
  onReply: () => void
  onForward: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [onClose])

  // Adjust position so menu doesn't go off screen
  const [pos, setPos] = useState({ x: menu.x, y: menu.y })
  useEffect(() => {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({
      x: Math.min(menu.x, window.innerWidth - r.width - 8),
      y: Math.min(menu.y, window.innerHeight - r.height - 8),
    })
  }, [menu.x, menu.y])

  const canEdit = isCreator && !menu.msg.is_deleted
  const canDelete = isCreator && !menu.msg.is_deleted

  return (
    <div ref={ref} style={{ ...cm.menu, left: pos.x, top: pos.y }}>
      <button style={cm.item} onClick={() => { onReact(); onClose() }}>😊 Реакция</button>
      <button style={cm.item} onClick={() => { onReply(); onClose() }}>↩️ Ответить</button>
      <button style={cm.item} onClick={() => { onForward(); onClose() }}>📤 Переслать</button>
      {canEdit && <button style={cm.item} onClick={() => { onEdit(); onClose() }}>✏️ Редактировать</button>}
      {canDelete && <button style={{ ...cm.item, color: 'var(--error,#e53e3e)' }} onClick={() => { onDelete(); onClose() }}>🗑 Удалить</button>}
    </div>
  )
}

// ─── Emoji Picker ─────────────────────────────────────────────────────────────

function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [onClose])
  return (
    <div ref={ref} style={ep.box}>
      {QUICK_EMOJIS.map(e => (
        <button key={e} style={ep.btn} onClick={() => { onPick(e); onClose() }}>{e}</button>
      ))}
    </div>
  )
}

// ─── Media Preview ─────────────────────────────────────────────────────────────

function MediaPreview({ media, onRemove }: { media: ChannelMedia; onRemove: () => void }) {
  return (
    <div style={mp.wrap}>
      {media.type === 'image' || media.type === 'gif'
        ? <img src={media.data} style={mp.thumb} alt="" />
        : media.type === 'video'
          ? <video src={media.data} style={mp.thumb} />
          : <div style={mp.audioIcon}>🎵 {media.name}</div>
      }
      <button style={mp.remove} onClick={onRemove}>✕</button>
      <div style={mp.size}>{((media.size ?? 0) / 1024).toFixed(0)} KB</div>
    </div>
  )
}

// ─── Media Renderer ───────────────────────────────────────────────────────────

function MediaRenderer({ media }: { media: ChannelMedia }) {
  const [lightbox, setLightbox] = useState(false)
  if (media.type === 'image' || media.type === 'gif') {
    return (
      <>
        <img
          src={media.data} alt={media.name}
          style={{ maxWidth: 280, maxHeight: 220, borderRadius: 8, cursor: 'zoom-in', display: 'block', marginTop: 4 }}
          onClick={() => setLightbox(true)}
        />
        {lightbox && (
          <div style={lb.overlay} onClick={() => setLightbox(false)}>
            <img src={media.data} style={lb.img} alt="" />
          </div>
        )}
      </>
    )
  }
  if (media.type === 'video') {
    return <video src={media.data} controls style={{ maxWidth: 280, borderRadius: 8, marginTop: 4, display: 'block' }} />
  }
  return (
    <audio controls src={media.data} style={{ width: 240, marginTop: 4, display: 'block' }} />
  )
}

// ─── Reactions Bar ────────────────────────────────────────────────────────────

function ReactionsBar({
  eventId, reactions, myPubkey, channelId, authorPubkey,
}: {
  eventId: string
  reactions: ChannelReaction[]
  myPubkey: string
  channelId: string
  authorPubkey: string
}) {
  const { sendChannelReaction, removeChannelReaction } = useStore()
  const grouped = useMemo(() => {
    const m: Record<string, { count: number; mine: string | null }> = {}
    for (const r of reactions) {
      if (!m[r.emoji]) m[r.emoji] = { count: 0, mine: null }
      m[r.emoji].count++
      if (r.reactor_pubkey === myPubkey) m[r.emoji].mine = r.reaction_event_id
    }
    return m
  }, [reactions, myPubkey])

  if (Object.keys(grouped).length === 0) return null

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
      {Object.entries(grouped).map(([emoji, { count, mine }]) => (
        <button
          key={emoji}
          style={{
            ...rb.pill,
            background: mine ? 'var(--accent)' : 'var(--bg-tertiary,var(--bg-secondary))',
            color: mine ? 'white' : 'var(--text-primary)',
            border: mine ? '1px solid var(--accent)' : '1px solid var(--border)',
          }}
          onClick={async () => {
            if (mine) { await removeChannelReaction(mine) }
            else { await sendChannelReaction(eventId, channelId, authorPubkey, emoji) }
          }}
          title={mine ? 'Убрать реакцию' : 'Поставить реакцию'}
        >
          {emoji} {count}
        </button>
      ))}
    </div>
  )
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  msg, myPubkey, channelId, reactions, allMessages,
  onContextMenu, onOpenThread, editingId, onEditDone,
}: {
  msg: NostrMessage
  myPubkey: string
  channelId: string
  reactions: ChannelReaction[]
  allMessages: NostrMessage[]
  onContextMenu: (e: React.MouseEvent, msg: NostrMessage) => void
  onOpenThread: (msg: NostrMessage) => void
  editingId: string | null
  onEditDone: () => void
}) {
  const { editChannelMessage } = useStore()
  const [editText, setEditText] = useState('')
  const editing = editingId === msg.event_id

  const { text, media } = parseChannelContent(msg.content)
  const commentCount = allMessages.filter(m => m.reply_to === msg.event_id).length

  useEffect(() => {
    if (editing) setEditText(text)
  }, [editing])

  const saveEdit = async () => {
    const newContent = buildChannelContent(editText.trim(), media)
    if (!newContent.trim()) return
    await editChannelMessage(msg.event_id, channelId, newContent)
    onEditDone()
  }

  if (msg.is_deleted) {
    return (
      <div style={s.deletedBubble}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>🗑 Сообщение удалено</span>
      </div>
    )
  }

  return (
    <div
      style={{ ...s.msg, flexDirection: msg.is_mine ? 'row-reverse' : 'row' }}
      onContextMenu={e => { e.preventDefault(); onContextMenu(e, msg) }}
    >
      {!msg.is_mine && (
        <div style={s.senderAvatar}>
          {(msg.sender_name?.[0] ?? msg.sender_pubkey[0] ?? '?').toUpperCase()}
        </div>
      )}
      <div style={{ maxWidth: '72%' }}>
        {!msg.is_mine && (
          <div style={s.senderName}>{msg.sender_name ?? shortPk(msg.sender_pubkey)}</div>
        )}
        {/* Reply-to quote */}
        {msg.reply_to && (() => {
          const parent = allMessages.find(m => m.event_id === msg.reply_to)
          if (!parent) return null
          const { text: qt } = parseChannelContent(parent.content)
          return (
            <div style={s.replyQuote}>
              <span style={{ fontWeight: 600, fontSize: 11 }}>{parent.sender_name ?? shortPk(parent.sender_pubkey)}</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}> {qt.slice(0, 60)}{qt.length > 60 ? '…' : ''}</span>
            </div>
          )
        })()}
        <div style={{
          ...s.bubble,
          background: msg.is_mine ? 'var(--bubble-out-bg)' : 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          borderRadius: 0,
          borderLeft: msg.is_mine ? '2px solid var(--accent)' : '2px solid var(--text-muted)',
          borderTop: '1px solid var(--border)',
          borderRight: '1px solid var(--border)',
          borderBottom: '1px solid var(--border)',
        }}>
          {editing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <textarea
                autoFocus
                style={{ ...s.editArea }}
                value={editText}
                onChange={e => setEditText(e.target.value)}
                rows={2}
              />
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button className="btn-icon" style={{ fontSize: 12 }} onClick={() => onEditDone()}>Отмена</button>
                <button className="btn-primary" style={{ fontSize: 12, padding: '2px 10px' }} onClick={saveEdit}>Сохранить</button>
              </div>
            </div>
          ) : (
            <>
              {media && <MediaRenderer media={media} />}
              {text && <div style={{ fontSize: 14, lineHeight: 1.45 }}>{renderChannelText(text)}</div>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', marginTop: 2 }}>
                {msg.edited_at && (
                  <span style={{ fontSize: 10, opacity: 0.7 }}>✏️</span>
                )}
                <span style={{ fontSize: 10, opacity: 0.7 }}>{formatTime(msg.timestamp)}</span>
              </div>
            </>
          )}
        </div>

        {/* Reactions */}
        <ReactionsBar
          eventId={msg.event_id}
          reactions={reactions}
          myPubkey={myPubkey}
          channelId={channelId}
          authorPubkey={msg.sender_pubkey}
        />

        {/* Comment count */}
        {commentCount > 0 && !msg.reply_to && (
          <button style={s.commentCount} onClick={() => onOpenThread(msg)}>
            💬 {commentCount} {commentCount === 1 ? 'комментарий' : commentCount < 5 ? 'комментария' : 'комментариев'}
          </button>
        )}
        {!msg.reply_to && (
          <button style={s.commentBtn} onClick={() => onOpenThread(msg)}>
            ↩️ Ответить
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Comment Thread Modal ─────────────────────────────────────────────────────

function CommentThreadModal({
  post, allMessages, channelId, myPubkey, reactions,
  onClose, onCtxMenu,
}: {
  post: NostrMessage
  allMessages: NostrMessage[]
  channelId: string
  myPubkey: string
  reactions: Record<string, ChannelReaction[]>
  onClose: () => void
  onCtxMenu: (e: React.MouseEvent, msg: NostrMessage) => void
}) {
  const { sendComment } = useStore()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const comments = allMessages.filter(m => m.reply_to === post.event_id)
  const { text: postText, media: postMedia } = parseChannelContent(post.content)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [comments.length])

  const send = async () => {
    const t = text.trim()
    if (!t || sending) return
    setText('')
    setSending(true)
    try { await sendComment(channelId, post.event_id, t) }
    catch (e) { console.error(e) }
    finally { setSending(false) }
  }

  return (
    <div style={th.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={th.modal} className="fade-in">
        <div style={th.header}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>💬 Комментарии</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        {/* Original post preview */}
        <div style={th.originalPost}>
          {postMedia && <MediaRenderer media={postMedia} />}
          {postText && <div style={{ fontSize: 13, lineHeight: 1.4 }}>{renderChannelText(postText)}</div>}
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>{formatTime(post.timestamp)}</div>
        </div>
        {/* Comments list */}
        <div style={th.list}>
          {comments.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '24px 0' }}>
              Нет комментариев. Будь первым!
            </div>
          )}
          {comments.map(c => {
            const { text: ct, media: cm } = parseChannelContent(c.content)
            return (
              <div key={c.event_id} style={th.comment}
                onContextMenu={e => { e.preventDefault(); onCtxMenu(e, c) }}>
                <div style={th.commentAvatar}>
                  {(c.sender_name?.[0] ?? c.sender_pubkey[0] ?? '?').toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
                    {c.sender_name ?? shortPk(c.sender_pubkey)} · {formatTime(c.timestamp)}
                    {c.edited_at && <span> ✏️</span>}
                  </div>
                  {c.is_deleted
                    ? <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>🗑 Удалено</span>
                    : <>
                        {cm && <MediaRenderer media={cm} />}
                        {ct && <div style={{ fontSize: 13 }}>{renderChannelText(ct)}</div>}
                      </>
                  }
                  <ReactionsBar
                    eventId={c.event_id}
                    reactions={reactions[c.event_id] ?? []}
                    myPubkey={myPubkey}
                    channelId={channelId}
                    authorPubkey={c.sender_pubkey}
                  />
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>
        {/* Comment input — all subscribers */}
        <div style={th.inputRow}>
          <textarea
            style={th.textarea}
            placeholder="Написать комментарий..."
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            rows={1}
            maxLength={500}
          />
          <button className="btn-primary" style={th.sendBtn} onClick={send} disabled={!text.trim() || sending}>➤</button>
        </div>
      </div>
    </div>
  )
}

// ─── Forward Modal ────────────────────────────────────────────────────────────

function ForwardModal({ msg, onClose }: { msg: NostrMessage; onClose: () => void }) {
  const { contacts, sendMessage } = useStore()
  const { text, media } = parseChannelContent(msg.content)
  const preview = media ? `📎 [медиа] ${text}` : text

  const send = async (pk: string) => {
    await sendMessage(pk, `📤 Переслано:\n─────────────────────\n${preview}`)
    onClose()
  }

  return (
    <div style={fw.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={fw.modal} className="fade-in">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontWeight: 600 }}>📤 Переслать</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div style={fw.preview}>{preview.slice(0, 120)}{preview.length > 120 ? '…' : ''}</div>
        <div style={fw.list}>
          {contacts.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
              Нет контактов
            </div>
          )}
          {contacts.map(c => (
            <button key={c.public_key} style={fw.contact} onClick={() => send(c.public_key)}>
              <div style={fw.avatar}>{c.nickname[0].toUpperCase()}</div>
              <span style={{ fontSize: 14 }}>{c.local_alias ?? c.nickname}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main ChannelWindow ───────────────────────────────────────────────────────

export default function ChannelWindow() {
  const {
    activeChannel, channelMessages, channelReactions,
    sendChannelMessage, nostrPubkey, addChannelMessage,
    deleteChannelMessage, loadChannels, setActiveChannel,
    updateChannelMeta, deleteChannel, getSubscriberCount,
  } = useStore()

  const [subscriberCount, setSubscriberCount] = useState(0)
  useEffect(() => {
    if (!activeChannel) return
    getSubscriberCount(activeChannel.channel_id).then(setSubscriberCount).catch(() => {})
  }, [activeChannel?.channel_id])

  const isCreator = !!nostrPubkey && !!activeChannel && activeChannel.creator_pubkey === nostrPubkey
  const myPubkey = nostrPubkey ?? ''

  // Top-level posts only (no reply_to), sorted by timestamp
  const topLevelMessages = useMemo(
    () => channelMessages.filter(m => !m.reply_to),
    [channelMessages]
  )

  // ── Input state ──────────────────────────────────────────────────────────
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [pendingMedia, setPendingMedia] = useState<ChannelMedia | null>(null)
  const [replyTo, setReplyTo] = useState<NostrMessage | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLInputElement>(null)
  const gifRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // ── UI state ─────────────────────────────────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)
  const [emojiPickerFor, setEmojiPickerFor] = useState<NostrMessage | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [threadPost, setThreadPost] = useState<NostrMessage | null>(null)
  const [forwardMsg, setForwardMsg] = useState<NostrMessage | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [topLevelMessages.length])

  if (!activeChannel) {
    return (
      <div style={s.empty}>
        <div style={{ fontSize: 48 }}>📡</div>
        <div style={s.emptyText}>Выберите канал</div>
        <div style={s.emptyHint}>Каналы работают через Nostr — децентрализованную сеть</div>
      </div>
    )
  }

  // ── File picker ───────────────────────────────────────────────────────────
  const pickFile = (type: ChannelMedia['type'], file: File) => {
    if (file.size > MAX_MEDIA_BYTES) {
      alert(`Файл слишком большой (макс. ${MAX_MEDIA_BYTES / 1024} KB)`)
      return
    }
    const reader = new FileReader()
    reader.onload = ev => {
      const data = ev.target?.result as string
      setPendingMedia({ type, data, name: file.name, size: file.size })
    }
    reader.readAsDataURL(file)
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  const send = async () => {
    const t = text.trim()
    if ((!t && !pendingMedia) || sending) return
    const content = buildChannelContent(t, pendingMedia)
    setText('')
    setPendingMedia(null)
    const replyTarget = replyTo
    setReplyTo(null)
    setSending(true)
    try {
      if (replyTarget) {
        await useStore.getState().sendComment(activeChannel.channel_id, replyTarget.event_id, content)
      } else {
        await sendChannelMessage(activeChannel.channel_id, content)
        addChannelMessage({
          id: -Date.now(),
          event_id: `local_${Date.now()}`,
          channel_id: activeChannel.channel_id,
          sender_pubkey: myPubkey,
          sender_name: null,
          content,
          timestamp: Math.floor(Date.now() / 1000),
          reply_to: null,
          is_mine: true,
          edited_at: null,
          is_deleted: false,
        })
      }
    } catch (e) { console.error(e) }
    finally { setSending(false) }
  }

  const handleLeave = async () => {
    if (!confirm(`Покинуть канал «${activeChannel.name || activeChannel.channel_id.slice(0, 12)}»?`)) return
    try { await useStore.getState().leaveChannel(activeChannel.channel_id); setActiveChannel(null); loadChannels() }
    catch (e) { console.error(e) }
  }

  const handleDelete = async () => {
    if (!confirm(`Удалить канал «${activeChannel.name || activeChannel.channel_id.slice(0, 12)}» для всех?`)) return
    try { await deleteChannel(activeChannel.channel_id); setActiveChannel(null); loadChannels() }
    catch (e) { console.error(e) }
  }

  const handleCtxMenu = (e: React.MouseEvent, msg: NostrMessage) => {
    setCtxMenu({ x: e.clientX, y: e.clientY, msg })
  }

  const lastDate = { val: '' }

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <ChannelAvatar channel={activeChannel} size={36} />
        <div style={s.headerInfo}>
          <div style={s.channelName}>{activeChannel.name || 'Канал'}</div>
          {activeChannel.about && (
            <div style={s.channelAbout}>{activeChannel.about}</div>
          )}
          <div style={s.channelId}>
            {subscriberCount > 0 ? `${subscriberCount} подписч. · ` : ''}
            <span
              title={activeChannel.channel_id}
              style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
              onClick={() => navigator.clipboard.writeText(activeChannel.channel_id)}
            >
              ID: {activeChannel.channel_id.slice(0, 12)}…
            </span>
          </div>
        </div>
        <div style={s.nostrBadge}>⚡ Nostr</div>
        <button className="btn-icon" title="Настройки канала" style={{ fontSize: 16, flexShrink: 0 }}
          onClick={() => setShowSettings(true)}>⚙️</button>
        <button className="btn-icon" title="Покинуть канал"
          style={{ fontSize: 16, color: 'var(--error,#e53e3e)', flexShrink: 0 }}
          onClick={handleLeave}>🚪</button>
      </div>

      {/* Messages */}
      <div style={s.messages}>
        {topLevelMessages.length === 0 && (
          <div style={s.emptyMessages}>Нет постов. {isCreator ? 'Напишите первым!' : 'Подождите публикации.'}</div>
        )}
        {topLevelMessages.map(msg => {
          const dateStr = formatDate(msg.timestamp)
          const showDate = dateStr !== lastDate.val
          lastDate.val = dateStr
          return (
            <div key={msg.event_id || msg.id}>
              {showDate && <div style={s.dateSep}>{dateStr}</div>}
              <MessageBubble
                msg={msg}
                myPubkey={myPubkey}
                channelId={activeChannel.channel_id}
                reactions={channelReactions[msg.event_id] ?? []}
                allMessages={channelMessages}
                onContextMenu={handleCtxMenu}
                editingId={editingId}
                onEditDone={() => setEditingId(null)}
                onOpenThread={(m) => setThreadPost(m)}
              />
              {/* Quick emoji picker under bubble */}
              {emojiPickerFor?.event_id === msg.event_id && (
                <EmojiPicker
                  onPick={async (emoji) => {
                    await useStore.getState().sendChannelReaction(
                      msg.event_id, activeChannel.channel_id, msg.sender_pubkey, emoji
                    )
                  }}
                  onClose={() => setEmojiPickerFor(null)}
                />
              )}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Reply indicator */}
      {replyTo && (
        <div style={s.replyBar}>
          <span style={{ fontSize: 12 }}>↩️ Ответ на: <b>{parseChannelContent(replyTo.content).text.slice(0, 50)}</b></span>
          <button className="btn-icon" onClick={() => setReplyTo(null)} style={{ fontSize: 12 }}>✕</button>
        </div>
      )}

      {/* Media preview */}
      {pendingMedia && (
        <div style={{ padding: '4px 12px' }}>
          <MediaPreview media={pendingMedia} onRemove={() => setPendingMedia(null)} />
        </div>
      )}

      {/* Input area */}
      {isCreator || replyTo ? (
        <div style={s.inputRow}>
          {isCreator && !replyTo && (
            <>
              {/* Media buttons */}
              <input ref={imageRef} type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) pickFile('image', f); e.target.value = '' }} />
              <input ref={videoRef} type="file" accept="video/mp4,video/webm" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) pickFile('video', f); e.target.value = '' }} />
              <input ref={audioRef} type="file" accept="audio/mpeg,audio/ogg,audio/wav" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) pickFile('audio', f); e.target.value = '' }} />
              <input ref={gifRef} type="file" accept="image/gif" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) pickFile('gif', f); e.target.value = '' }} />
              <button className="btn-icon" title="Фото" style={s.mediaBtn} onClick={() => imageRef.current?.click()}>🖼</button>
              <button className="btn-icon" title="Видео" style={s.mediaBtn} onClick={() => videoRef.current?.click()}>🎬</button>
              <button className="btn-icon" title="Аудио" style={s.mediaBtn} onClick={() => audioRef.current?.click()}>🎵</button>
              <button className="btn-icon" title="GIF" style={{ ...s.mediaBtn, fontSize: 10, fontWeight: 700, fontFamily: 'monospace' }}
                onClick={() => gifRef.current?.click()}>GIF</button>
            </>
          )}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <textarea
              ref={textareaRef}
              style={s.textarea}
              placeholder={replyTo ? 'Комментарий...' : 'Сообщение в канал...'}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              rows={1}
              maxLength={1000}
            />
            {text.length > 800 && (
              <div style={{ fontSize: 10, color: text.length >= 1000 ? 'var(--error,#e53e3e)' : 'var(--text-muted)', textAlign: 'right', paddingRight: 4 }}>
                {text.length}/1000
              </div>
            )}
          </div>
          <button className="btn-primary" style={s.sendBtn}
            onClick={send} disabled={(!text.trim() && !pendingMedia) || sending}>➤</button>
        </div>
      ) : (
        <div style={{ ...s.inputRow, justifyContent: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
            Только создатель канала может публиковать посты · вы можете комментировать
          </span>
        </div>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          menu={ctxMenu}
          isCreator={isCreator}
          onEdit={() => {
            setEditingId(ctxMenu.msg.event_id)
          }}
          onDelete={async () => {
            if (!confirm('Удалить это сообщение?')) return
            await deleteChannelMessage(ctxMenu.msg.event_id)
          }}
          onReact={() => setEmojiPickerFor(ctxMenu.msg)}
          onReply={() => { setReplyTo(ctxMenu.msg); textareaRef.current?.focus() }}
          onForward={() => setForwardMsg(ctxMenu.msg)}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Thread modal */}
      {threadPost && (
        <CommentThreadModal
          post={threadPost}
          allMessages={channelMessages}
          channelId={activeChannel.channel_id}
          myPubkey={myPubkey}
          reactions={channelReactions}
          onClose={() => setThreadPost(null)}
          onCtxMenu={handleCtxMenu}
        />
      )}

      {/* Forward modal */}
      {forwardMsg && (
        <ForwardModal msg={forwardMsg} onClose={() => setForwardMsg(null)} />
      )}

      {/* Channel settings modal */}
      {showSettings && (
        <ChannelSettingsModal
          channel={activeChannel}
          isCreator={isCreator}
          onClose={() => setShowSettings(false)}
          onSave={async (name, about, picture) => {
            await updateChannelMeta(activeChannel.channel_id, name, about, picture)
            setShowSettings(false)
          }}
          onDelete={isCreator ? handleDelete : undefined}
        />
      )}
    </div>
  )
}

// ─── renderChannelText ────────────────────────────────────────────────────────

function renderChannelText(text: string): React.ReactNode {
  const nodes: React.ReactNode[] = []
  const fencedRe = /```([^\n]*)\n?([\s\S]*?)```/g
  let last = 0, key = 0
  let match: RegExpExecArray | null
  while ((match = fencedRe.exec(text)) !== null) {
    if (match.index > last) nodes.push(...splitInlineCode(text.slice(last, match.index), key++))
    nodes.push(
      <pre key={key++} style={{
        background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(0,0,0,0.2)',
        borderRadius: 6, padding: '8px 10px', margin: '4px 0',
        fontSize: 12, fontFamily: 'monospace', overflowX: 'auto',
        whiteSpace: 'pre', color: 'inherit',
      }}>
        <code>{match[2]}</code>
      </pre>
    )
    last = match.index + match[0].length
  }
  if (last < text.length) nodes.push(...splitInlineCode(text.slice(last), key++))
  return <>{nodes}</>
}

function splitInlineCode(text: string, baseKey: number): React.ReactNode[] {
  return text.split(/(`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={`${baseKey}-${i}`} style={{
        background: 'rgba(0,0,0,0.15)', borderRadius: 3,
        padding: '1px 4px', fontFamily: 'monospace', fontSize: 12,
      }}>{part.slice(1, -1)}</code>
    }
    return <span key={`${baseKey}-${i}`} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>
  })
}

// ─── ChannelAvatar ────────────────────────────────────────────────────────────

function ChannelAvatar({ channel, size }: { channel: { name: string; picture: string }; size: number }) {
  if (channel.picture && channel.picture.startsWith('data:')) {
    return <img src={channel.picture} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} alt="" />
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'var(--accent)', color: 'white',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.45, fontWeight: 700, flexShrink: 0,
    }}>
      {channel.name ? channel.name.charAt(0).toUpperCase() : '📢'}
    </div>
  )
}

// ─── ChannelSettingsModal ─────────────────────────────────────────────────────

function ChannelSettingsModal({
  channel, onClose, onSave, isCreator, onDelete,
}: {
  channel: { channel_id: string; name: string; about: string; picture: string }
  isCreator: boolean
  onClose: () => void
  onSave: (name: string, about: string, picture: string) => Promise<void>
  onDelete?: () => void
}) {
  const [name, setName] = useState(channel.name)
  const [about, setAbout] = useState(channel.about)
  const [picture, setPicture] = useState(channel.picture)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { alert('Изображение слишком большое (макс. 2 МБ)'); return }
    const reader = new FileReader()
    reader.onload = ev => setPicture(ev.target?.result as string)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try { await onSave(name.trim(), about.trim(), picture) }
    catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  return (
    <div style={ms.overlay} onClick={onClose}>
      <div style={ms.modal} onClick={e => e.stopPropagation()}>
        <div style={ms.header}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>⚙️ Настройки канала</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginBottom: 14 }}>
          <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => fileRef.current?.click()}>
            <ChannelAvatar channel={{ name, picture }} size={72} />
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              background: 'rgba(0,0,0,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 24,
            }}>📷</div>
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Нажмите для смены аватара</span>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
        </div>
        {/* Channel ID with copy */}
        <div style={{ marginBottom: 8 }}>
          <label style={ms.label}>ID канала</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <div style={{
              ...ms.input, flex: 1, fontSize: 11, fontFamily: 'monospace',
              color: 'var(--text-secondary)', overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              padding: '6px 10px', userSelect: 'all',
            }}>
              {channel.channel_id}
            </div>
            <button
              className="btn-icon"
              title="Скопировать ID"
              style={{ flexShrink: 0, fontSize: 16 }}
              onClick={() => {
                navigator.clipboard.writeText(channel.channel_id)
              }}
            >📋</button>
          </div>
        </div>
        <label style={ms.label}>Название</label>
        <input style={ms.input} value={name} onChange={e => setName(e.target.value)} maxLength={64} />
        <label style={{ ...ms.label, marginTop: 8 }}>Описание</label>
        <textarea style={{ ...ms.input, minHeight: 64, resize: 'vertical' as const }}
          value={about} onChange={e => setAbout(e.target.value)} maxLength={256} />
        <button className="btn-primary" style={{ width: '100%', marginTop: 12 }}
          onClick={handleSave} disabled={saving || !name.trim()}>
          {saving ? 'Сохранение...' : 'Сохранить'}
        </button>
        {isCreator && onDelete && (
          <>
            <div style={{ borderTop: '1px solid var(--border)', margin: '16px 0 12px' }} />
            <button
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 10,
                background: 'rgba(229,62,62,0.1)', color: 'var(--error,#e53e3e)',
                border: '1px solid rgba(229,62,62,0.3)', cursor: 'pointer',
                fontSize: 14, fontWeight: 600,
              }}
              onClick={() => { onClose(); onDelete() }}
            >
              🗑 Удалить канал для всех
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', flex: 1, height: '100vh', overflow: 'hidden' },
  empty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text-muted)' },
  emptyText: { fontSize: 18, fontWeight: 600, color: 'var(--text-secondary)' },
  emptyHint: { fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', maxWidth: 280 },
  header: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', flexShrink: 0 },
  headerInfo: { flex: 1, minWidth: 0 },
  channelName: { fontWeight: 600, fontSize: 15 },
  channelAbout: { fontSize: 11, color: 'var(--text-secondary)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  channelId: { fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 1 },
  nostrBadge: { fontSize: 11, background: 'rgba(128,0,255,0.12)', color: '#9b59b6', borderRadius: 6, padding: '2px 8px', border: '1px solid rgba(128,0,255,0.2)', fontWeight: 600, flexShrink: 0 },
  messages: { flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 4 },
  emptyMessages: { textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, marginTop: 40 },
  dateSep: { textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', margin: '12px 0 4px', fontWeight: 500 },
  msg: { display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 },
  senderAvatar: { width: 28, height: 28, borderRadius: '50%', background: 'var(--accent)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0, marginTop: 2 },
  senderName: { fontSize: 11, color: 'var(--text-muted)', marginBottom: 2, paddingLeft: 4 },
  bubble: { padding: '8px 12px', borderRadius: 16, fontSize: 14, lineHeight: 1.5, wordBreak: 'break-word', display: 'flex', flexDirection: 'column', gap: 2 },
  deletedBubble: { padding: '6px 12px', borderRadius: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border)', display: 'inline-block', marginBottom: 4 },
  replyQuote: { background: 'rgba(0,0,0,0.08)', borderLeft: '2px solid var(--accent)', borderRadius: '0 6px 6px 0', padding: '3px 8px', marginBottom: 4, fontSize: 12 },
  commentCount: { fontSize: 11, color: 'var(--accent)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 0', marginTop: 2, display: 'block' },
  commentBtn: { fontSize: 11, color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 0', marginTop: 1 },
  replyBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 12px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', fontSize: 12 },
  inputRow: { display: 'flex', gap: 8, padding: '10px 12px', borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)', flexShrink: 0, alignItems: 'flex-end' },
  mediaBtn: { fontSize: 16, flexShrink: 0, padding: '4px', marginBottom: 2 },
  textarea: { flex: 1, resize: 'none', borderRadius: 20, padding: '8px 14px', fontSize: 14, lineHeight: 1.4, maxHeight: 120, overflowY: 'auto', background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--input-border)' },
  editArea: { width: '100%', minHeight: 40, resize: 'vertical', borderRadius: 8, padding: '6px 8px', fontSize: 13, background: 'rgba(0,0,0,0.1)', color: 'inherit', border: '1px solid rgba(255,255,255,0.2)', boxSizing: 'border-box' as const },
  sendBtn: { borderRadius: '50%', width: 40, height: 40, padding: 0, fontSize: 16, flexShrink: 0 },
}

const cm: Record<string, React.CSSProperties> = {
  menu: { position: 'fixed', zIndex: 9000, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, padding: '4px', boxShadow: '0 8px 24px rgba(0,0,0,0.25)', minWidth: 160, display: 'flex', flexDirection: 'column' },
  item: { padding: '8px 14px', borderRadius: 7, fontSize: 13, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--text-primary)', width: '100%' },
}

const ep: Record<string, React.CSSProperties> = {
  box: { display: 'flex', gap: 4, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 12, padding: '6px 8px', boxShadow: '0 4px 16px rgba(0,0,0,0.2)', flexWrap: 'wrap', maxWidth: 200 },
  btn: { fontSize: 20, background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, borderRadius: 6 },
}

const rb: Record<string, React.CSSProperties> = {
  pill: { borderRadius: 12, padding: '2px 8px', fontSize: 12, cursor: 'pointer', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 },
}

const mp: Record<string, React.CSSProperties> = {
  wrap: { position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px' },
  thumb: { width: 48, height: 48, objectFit: 'cover', borderRadius: 4 },
  audioIcon: { fontSize: 12, color: 'var(--text-muted)' },
  remove: { position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', background: 'var(--error,#e53e3e)', color: 'white', border: 'none', cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 },
  size: { fontSize: 10, color: 'var(--text-muted)' },
}

const lb: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' },
  img: { maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 4 },
}

const th: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 5000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
  modal: { background: 'var(--bg-primary)', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 -4px 32px rgba(0,0,0,0.3)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' },
  originalPost: { padding: '10px 16px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', maxHeight: 120, overflow: 'hidden' },
  list: { flex: 1, overflowY: 'auto', padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 8 },
  comment: { display: 'flex', gap: 8, alignItems: 'flex-start' },
  commentAvatar: { width: 28, height: 28, borderRadius: '50%', background: 'var(--accent)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 },
  inputRow: { display: 'flex', gap: 8, padding: '10px 12px', borderTop: '1px solid var(--border)', alignItems: 'flex-end' },
  textarea: { flex: 1, resize: 'none', borderRadius: 16, padding: '8px 12px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--input-border)', maxHeight: 80, overflowY: 'auto' },
  sendBtn: { borderRadius: '50%', width: 36, height: 36, padding: 0, fontSize: 14, flexShrink: 0 },
}

const fw: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 6000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: { background: 'var(--bg-primary)', borderRadius: 14, padding: '16px 20px', width: 320, maxHeight: '70vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' },
  preview: { fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-secondary)', borderRadius: 8, padding: '8px 10px', marginBottom: 10, wordBreak: 'break-word' },
  list: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 },
  contact: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%', color: 'var(--text-primary)' },
  avatar: { width: 32, height: 32, borderRadius: '50%', background: 'var(--accent)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, flexShrink: 0 },
}

const ms: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: { background: 'var(--bg-secondary)', borderRadius: 14, padding: 24, width: 360, boxShadow: '0 8px 32px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', gap: 4 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  label: { fontSize: 12, color: 'var(--text-muted)' },
  input: { padding: '8px 12px', borderRadius: 10, fontSize: 14, border: '1px solid var(--input-border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none', width: '100%', boxSizing: 'border-box' as const },
}
