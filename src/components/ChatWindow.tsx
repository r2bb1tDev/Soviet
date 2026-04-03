import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useStore, Message, Contact } from '../store'
import ContactProfile from './ContactProfile'

const EMOJI_LIST = [
  '😀','😂','😍','🥺','😎','😢','😡','🤔','👍','👎',
  '❤️','🔥','✨','💯','🙏','👋','🎉','🤝','💪','🏆',
  '😊','🥰','😘','🤗','😜','🤣','😔','😴','🤩','🥳',
  '👀','💬','✅','❌','⚡','🌟','💡','🔒','🐻','🚀',
]

const QUICK_REACTIONS = ['👍','❤️','😂','😮','😢','🔥']

export default function ChatWindow() {
  const {
    activeChat, messages, decryptedMessages, identity, reactions,
    contacts, sendMessage, loadChats, typingUsers, sendTyping,
    addReaction, removeReaction, editMessage, deleteMessage,
    leaveGroup, deleteGroup, getGroupMembers, deleteChat, setActiveChat,
  } = useStore()

  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [contextMenu, setContextMenu] = useState<{
    msgId: number; x: number; y: number; isMine: boolean; text: string
  } | null>(null)
  const [forwardMsg, setForwardMsg] = useState<{ text: string } | null>(null)
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<number | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastEnterRef = useRef<number>(0)

  const isGroup = activeChat?.chat_type === 'group'
  const [groupMembers, setGroupMembers] = useState<import('../store').GroupMember[]>([])
  useEffect(() => {
    if (isGroup && activeChat?.group_id) {
      getGroupMembers(activeChat.group_id).then(setGroupMembers).catch(() => {})
    } else {
      setGroupMembers([])
    }
  }, [activeChat?.id])

  const isGroupAdmin = isGroup && groupMembers.some(
    m => m.public_key === identity?.public_key && m.is_admin
  )

  const handleLeaveGroup = async () => {
    if (!activeChat?.group_id) return
    if (!confirm('Покинуть группу?')) return
    try { await leaveGroup(activeChat.group_id) } catch (e) { console.error(e) }
  }

  const handleDeleteGroup = async () => {
    if (!activeChat?.group_id) return
    if (!confirm('Удалить группу для всех участников?')) return
    try { await deleteGroup(activeChat.group_id) } catch (e) { console.error(e) }
  }

  const handleDeleteChat = async () => {
    if (!activeChat) return
    if (!confirm('Удалить этот чат?')) return
    try {
      await deleteChat(activeChat.id)
      setActiveChat(null)
    } catch (e) { console.error(e) }
  }

  const contact = contacts.find(c => c.public_key === activeChat?.peer_key)
  const groupName = isGroup
    ? (activeChat as any)?.group_name ?? `Группа (${groupMembers.length})`
    : null
  const displayName = isGroup
    ? groupName
    : (contact?.local_alias ?? contact?.nickname
        ?? (activeChat?.peer_key ? activeChat.peer_key.slice(0, 12) + '...' : ''))

  const isTyping = activeChat?.peer_key ? (typingUsers[activeChat.peer_key] ?? false) : false

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    setText('')
    setSending(false)
    setShowEmoji(false)
    setEditingId(null)
    setContextMenu(null)
    textareaRef.current?.focus()
  }, [activeChat?.id])

  // Close context menu on click outside
  useEffect(() => {
    const close = () => { setContextMenu(null); setReactionPickerMsgId(null) }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    autoResize(e.target)
    if (activeChat?.peer_key) {
      sendTyping(activeChat.peer_key, true)
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
      typingTimerRef.current = setTimeout(() => {
        if (activeChat?.peer_key) sendTyping(activeChat.peer_key, false)
      }, 3000)
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !activeChat?.peer_key) return
    if (file.size > 10 * 1024 * 1024) { alert('Файл слишком большой (макс. 10 МБ)'); return }
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string
      const base64 = dataUrl.split(',')[1]
      try {
        await invoke('send_file', {
          recipientPk: activeChat.peer_key,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          dataBase64: base64,
        })
        const { activeChat: ac } = useStore.getState()
        if (ac && ac.id > 0) useStore.getState().loadMessages(ac.id)
      } catch (err) {
        console.error('File send error:', err)
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleSend = useCallback(async () => {
    if (!text.trim() || !activeChat?.peer_key || sending) return
    setSending(true)
    if (activeChat.peer_key) sendTyping(activeChat.peer_key, false)
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    try {
      await sendMessage(activeChat.peer_key, text.trim())
      setText('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      loadChats()
    } catch (e) {
      console.error('Send error:', e)
    } finally {
      setSending(false)
      textareaRef.current?.focus()
    }
  }, [text, activeChat, sending, sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const now = Date.now()
      if (now - lastEnterRef.current < 400) {
        lastEnterRef.current = 0
        handleSend()
      } else {
        lastEnterRef.current = now
      }
    }
  }

  const insertEmoji = (emoji: string) => {
    setText(t => t + emoji)
    setShowEmoji(false)
    textareaRef.current?.focus()
  }

  const handleRightClick = (e: React.MouseEvent, msg: Message, isMine: boolean, text: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ msgId: msg.id, x: e.clientX, y: e.clientY, isMine, text })
    setReactionPickerMsgId(null)
  }

  const startEdit = (msgId: number, currentText: string) => {
    setEditingId(msgId)
    setEditText(currentText)
    setContextMenu(null)
  }

  const submitEdit = async () => {
    if (!editingId || !activeChat) return
    try {
      await editMessage(editingId, activeChat.id, editText)
    } catch (e) { console.error(e) }
    setEditingId(null)
  }

  const handleDelete = async (msgId: number) => {
    if (!activeChat) return
    if (!confirm('Удалить это сообщение?')) return
    setContextMenu(null)
    try {
      await deleteMessage(msgId, activeChat.id)
    } catch (e) { console.error(e) }
  }

  const handleForward = (text: string) => {
    setForwardMsg({ text })
    setContextMenu(null)
  }

  const handleReact = async (msgId: number, emoji: string) => {
    if (!activeChat) return
    const myPk = identity?.public_key ?? ''
    const msgReactions = reactions[msgId] ?? []
    const existing = msgReactions.find(r => r.sender_key === myPk && r.emoji === emoji)
    try {
      if (existing) {
        await removeReaction(msgId, activeChat.id, emoji)
      } else {
        await addReaction(msgId, activeChat.id, emoji)
      }
    } catch (e) { console.error(e) }
    setReactionPickerMsgId(null)
    setContextMenu(null)
  }

  const grouped = groupByDate(messages)

  if (!activeChat) return null

  return (
    <div style={s.root} onClick={() => { setShowEmoji(false) }}>
      {/* ── Шапка ── */}
      <div style={s.header}>
        <div style={s.headerAvatar} onClick={() => !isGroup && contact && setShowProfile(true)}>
          {isGroup ? '👥' : (displayName as string)?.charAt(0).toUpperCase()}
          {!isGroup && contact && <span className={`status-dot ${contact.status}`} style={s.headerDot} />}
        </div>
        <div style={s.headerInfo}>
          <div style={s.headerName}>{displayName}</div>
          <div style={s.headerSub}>
            {isGroup
              ? <span style={{ color: 'var(--text-muted)' }}>{groupMembers.length} участн.</span>
              : isTyping
                ? <span style={{ color: 'var(--online)', fontStyle: 'italic' }}>печатает...</span>
                : contact
                  ? statusLabel(contact.status, contact.status_text)
                  : <span style={{ color: 'var(--text-muted)' }}>{activeChat.peer_key?.slice(0, 24)}...</span>
            }
          </div>
          {isGroup && groupMembers.length > 0 && (
            <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
              {groupMembers.slice(0, 8).map(m => (
                <div key={m.public_key} title={m.nickname} style={{
                  width: 20, height: 20, borderRadius: '50%',
                  background: 'var(--accent)', color: 'white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, flexShrink: 0,
                  border: '1px solid var(--bg-secondary)',
                }}>
                  {m.nickname.charAt(0).toUpperCase()}
                </div>
              ))}
              {groupMembers.length > 8 && (
                <div style={{
                  width: 20, height: 20, borderRadius: '50%',
                  background: 'var(--bg-tertiary)', color: 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, flexShrink: 0,
                }}>+{groupMembers.length - 8}</div>
              )}
            </div>
          )}
        </div>
        <div style={s.headerActions}>
          {!isGroup && contact && (
            <button className="btn-icon" title="Профиль" onClick={() => setShowProfile(true)}>👤</button>
          )}
          {!isGroup && (
            <button className="btn-icon" title="Удалить чат"
              style={{ fontSize: 15, color: 'var(--error,#e53e3e)' }}
              onClick={handleDeleteChat}>🗑</button>
          )}
          {isGroup && (
            <>
              <button className="btn-icon" title="Покинуть группу" onClick={handleLeaveGroup}
                style={{ fontSize: 15 }}>🚪</button>
              {isGroupAdmin && (
                <button className="btn-icon" title="Удалить группу"
                  style={{ fontSize: 15, color: 'var(--error,#e53e3e)' }}
                  onClick={handleDeleteGroup}>🗑</button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Сообщения ── */}
      <div style={s.messages}>
        {messages.length === 0 && (
          <div style={s.noMessages}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
              Сообщения зашифрованы E2E.<br />Напишите первое сообщение!
            </div>
          </div>
        )}

        {grouped.map(({ date, msgs }) => (
          <div key={date}>
            <DateDivider date={date} />
            {msgs.map(msg => {
              if (msg.content_type === 'system') {
                return (
                  <div key={msg.id} style={{
                    textAlign: 'center', padding: '4px 16px',
                    fontSize: 12, color: 'var(--text-muted)',
                    fontStyle: 'italic',
                  }}>
                    — {msg.content} —
                  </div>
                )
              }
              const isMine = msg.sender_key === identity?.public_key
              const text = decryptedMessages[msg.id] ?? ''
              const msgReactions = reactions[msg.id] ?? []
              return (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  isMine={isMine}
                  text={text}
                  msgReactions={msgReactions}
                  myPk={identity?.public_key ?? ''}
                  isEditing={editingId === msg.id}
                  editText={editText}
                  onEditChange={setEditText}
                  onEditSubmit={submitEdit}
                  onEditCancel={() => setEditingId(null)}
                  onContextMenu={(e) => handleRightClick(e, msg, isMine, text)}
                  onReact={(emoji) => handleReact(msg.id, emoji)}
                  showReactionPicker={reactionPickerMsgId === msg.id}
                  onToggleReactionPicker={(e) => {
                    e.stopPropagation()
                    setReactionPickerMsgId(v => v === msg.id ? null : msg.id)
                  }}
                />
              )
            })}
          </div>
        ))}

        {isTyping && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', padding: '0 12px 8px' }}>
            <div style={s.typingBubble}><TypingDots /></div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Emoji picker ── */}
      {showEmoji && (
        <div style={s.emojiPicker} onClick={e => e.stopPropagation()}>
          {EMOJI_LIST.map(emoji => (
            <button key={emoji} style={s.emojiBtn} onClick={() => insertEmoji(emoji)}>{emoji}</button>
          ))}
        </div>
      )}

      {/* ── Поле ввода ── */}
      <div style={s.inputArea}>
        <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileSelect} />
        <button className="btn-icon" title="Прикрепить файл" style={{ fontSize: 16, flexShrink: 0 }}
          onClick={() => fileInputRef.current?.click()}>📎</button>
        <button className="btn-icon" title="Emoji" style={{ fontSize: 18, flexShrink: 0 }}
          onClick={e => { e.stopPropagation(); setShowEmoji(v => !v) }}>😊</button>
        <button
          className="btn-icon"
          title="Вставить блок кода (```)"
          style={{ fontSize: 13, flexShrink: 0, fontFamily: 'monospace', fontWeight: 700 }}
          onClick={() => {
            const ta = textareaRef.current
            if (!ta) { setText(t => t + '```\n\n```'); return }
            const start = ta.selectionStart, end = ta.selectionEnd
            const sel = text.slice(start, end)
            const ins = sel ? `\`\`\`\n${sel}\n\`\`\`` : '```\n\n```'
            const next = text.slice(0, start) + ins + text.slice(end)
            setText(next)
            requestAnimationFrame(() => {
              const cur = sel ? start + ins.length : start + 4
              ta.setSelectionRange(cur, cur)
              ta.focus()
            })
          }}
        >{`</>`}</button>
        <textarea
          ref={textareaRef}
          style={s.textarea}
          placeholder="Напишите сообщение... (Enter — отправить, Shift+Enter — новая строка)"
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button
          className="btn-primary"
          style={{ ...s.sendBtn, opacity: (!text.trim() || sending) ? 0.5 : 1 }}
          onClick={handleSend}
          disabled={!text.trim() || sending}
        >
          {sending ? '…' : '▶'}
        </button>
      </div>

      {/* ── Context menu ── */}
      {contextMenu && (
        <div
          style={{
            ...s.contextMenu,
            left: Math.min(contextMenu.x, window.innerWidth - 180),
            top: Math.min(contextMenu.y, window.innerHeight - 200),
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Quick reactions */}
          <div style={s.contextReactions}>
            {QUICK_REACTIONS.map(emoji => (
              <button key={emoji} style={s.contextReactionBtn}
                onClick={() => handleReact(contextMenu.msgId, emoji)}>{emoji}</button>
            ))}
          </div>
          <div style={s.ctxDivider} />
          <button style={s.ctxItem} onClick={() => {
            navigator.clipboard.writeText(contextMenu.text)
            setContextMenu(null)
          }}>📋 Копировать</button>
          <button style={s.ctxItem} onClick={() => handleForward(contextMenu.text)}>↗ Переслать</button>
          {contextMenu.isMine && !messages.find(m => m.id === contextMenu.msgId)?.is_deleted && (
            <>
              <button style={s.ctxItem} onClick={() => startEdit(contextMenu.msgId, contextMenu.text)}>
                ✏️ Редактировать
              </button>
              <button style={{ ...s.ctxItem, color: 'var(--error, #e53e3e)' }}
                onClick={() => handleDelete(contextMenu.msgId)}>🗑 Удалить</button>
            </>
          )}
        </div>
      )}

      {/* ── Forward dialog ── */}
      {forwardMsg && (
        <ForwardDialog
          text={forwardMsg.text}
          contacts={contacts}
          onClose={() => setForwardMsg(null)}
          onForward={async (pk) => {
            try { await sendMessage(pk, forwardMsg.text) } catch {}
            setForwardMsg(null)
          }}
        />
      )}

      {/* ── Профиль контакта ── */}
      {showProfile && contact && (
        <ContactProfile contact={contact} onClose={() => setShowProfile(false)} />
      )}
    </div>
  )
}

// ─── renderMessageText — code blocks + inline code ────────────────────────────

function renderMessageText(text: string): React.ReactNode {
  const nodes: React.ReactNode[] = []
  // Split by fenced code blocks first
  const fencedRe = /```([^\n]*)\n?([\s\S]*?)```/g
  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = fencedRe.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(...renderInlineCode(text.slice(last, match.index), key++))
    }
    nodes.push(
      <pre key={key++} style={{
        background: 'var(--bg-primary)', border: '1px solid var(--border)',
        borderRadius: 6, padding: '8px 10px', margin: '4px 0',
        fontSize: 12, fontFamily: 'monospace', overflowX: 'auto',
        whiteSpace: 'pre', color: 'var(--text-primary)',
      }}>
        <code>{match[2]}</code>
      </pre>
    )
    last = match.index + match[0].length
  }
  if (last < text.length) {
    nodes.push(...renderInlineCode(text.slice(last), key++))
  }
  return <>{nodes}</>
}

function renderInlineCode(text: string, baseKey: number): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={baseKey + '-' + i} style={{
          background: 'rgba(0,0,0,0.12)', borderRadius: 3,
          padding: '1px 4px', fontFamily: 'monospace', fontSize: 12,
        }}>
          {part.slice(1, -1)}
        </code>
      )
    }
    return <span key={baseKey + '-' + i} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>
  })
}

// ─── MessageBubble ─────────────────────────────────────────────────────────────

interface BubbleProps {
  msg: Message
  isMine: boolean
  text: string
  msgReactions: { sender_key: string; emoji: string }[]
  myPk: string
  isEditing: boolean
  editText: string
  onEditChange: (v: string) => void
  onEditSubmit: () => void
  onEditCancel: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onReact: (emoji: string) => void
  showReactionPicker: boolean
  onToggleReactionPicker: (e: React.MouseEvent) => void
}

function MessageBubble({
  msg, isMine, text, msgReactions, myPk, isEditing, editText,
  onEditChange, onEditSubmit, onEditCancel,
  onContextMenu, onReact, showReactionPicker, onToggleReactionPicker,
}: BubbleProps) {
  const time = new Date(msg.timestamp * 1000).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })

  // Group reactions by emoji
  const reactionGroups = groupReactions(msgReactions, myPk)

  let fileContent: { file_name?: string; mime_type?: string; data?: string } | null = null
  if ((msg.content_type === 'file' || msg.content_type === 'image') && !msg.is_deleted && msg.edited_at === null) {
    try { fileContent = JSON.parse(text) } catch { /* not yet parsed */ }
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: isMine ? 'flex-end' : 'flex-start',
      marginBottom: 4,
      padding: '0 12px',
      position: 'relative',
    }}>
      <div style={{ position: 'relative', maxWidth: '68%' }}>
        {/* React button on hover */}
        <button
          style={{
            ...s.reactBtn,
            [isMine ? 'left' : 'right']: '100%',
            [isMine ? 'marginRight' : 'marginLeft']: 4,
          }}
          onClick={onToggleReactionPicker}
          title="Реакция"
        >😊</button>

        {/* Reaction picker */}
        {showReactionPicker && (
          <div style={{
            ...s.reactionPicker,
            [isMine ? 'right' : 'left']: 0,
          }}>
            {QUICK_REACTIONS.map(emoji => (
              <button key={emoji} style={s.emojiBtn} onClick={() => onReact(emoji)}>{emoji}</button>
            ))}
            <div style={s.ctxDivider} />
            {EMOJI_LIST.map(emoji => (
              <button key={emoji} style={s.emojiBtn} onClick={() => onReact(emoji)}>{emoji}</button>
            ))}
          </div>
        )}

        {/* Bubble */}
        <div
          style={{
            background: isMine ? 'var(--bubble-self)' : 'var(--bubble-other)',
            color: isMine ? 'var(--bubble-self-text)' : 'var(--bubble-other-text)',
            borderRadius: isMine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
            padding: fileContent?.mime_type?.startsWith('image/') ? '4px' : '8px 12px',
            boxShadow: '0 1px 3px var(--shadow)',
            border: isMine ? 'none' : '1px solid var(--border)',
            wordBreak: 'break-word',
            cursor: 'default',
            overflow: 'hidden',
            opacity: msg.is_deleted ? 0.6 : 1,
          }}
          onContextMenu={onContextMenu}
          onClick={onContextMenu}
        >
          {isEditing ? (
            <div>
              <textarea
                style={{ ...s.textarea, width: '100%', minWidth: 200, fontSize: 13 }}
                value={editText}
                onChange={e => onEditChange(e.target.value)}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEditSubmit() }
                  if (e.key === 'Escape') onEditCancel()
                }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button className="btn-primary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={onEditSubmit}>✓</button>
                <button className="btn-icon" style={{ fontSize: 11 }} onClick={onEditCancel}>✕</button>
              </div>
            </div>
          ) : fileContent?.mime_type?.startsWith('image/') && fileContent.data ? (
            <div>
              <img
                src={`data:${fileContent.mime_type};base64,${fileContent.data}`}
                style={{ maxWidth: 260, maxHeight: 260, borderRadius: 10, display: 'block' }}
                alt={fileContent.file_name}
              />
              <div style={{ padding: '4px 8px', fontSize: 11, opacity: 0.7, display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                <span>{time}</span>
                {isMine && <StatusIcon status={msg.status} />}
              </div>
            </div>
          ) : fileContent?.file_name ? (
            <div>
              <a href={fileContent.data ? `data:${fileContent.mime_type};base64,${fileContent.data}` : '#'}
                download={fileContent.file_name}
                style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: 'inherit', padding: '4px 0' }}>
                <span style={{ fontSize: 24 }}>📎</span>
                <span style={{ fontSize: 13, flex: 1 }}>{fileContent.file_name}</span>
              </a>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, marginTop: 4, fontSize: 10, opacity: 0.7 }}>
                <span>{time}</span>
                {isMine && <StatusIcon status={msg.status} />}
              </div>
            </div>
          ) : (
            <>
              <div style={{
                fontSize: 14, lineHeight: 1.45,
                fontStyle: msg.is_deleted ? 'italic' : 'normal',
                color: msg.is_deleted ? 'var(--text-muted)' : undefined,
              }}>
                {text ? renderMessageText(text) : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>расшифровка...</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 3 }}>
                {msg.edited_at && !msg.is_deleted && (
                  <span style={{ fontSize: 9, opacity: 0.6 }}>изменено</span>
                )}
                <span style={{ fontSize: 10, color: isMine ? 'rgba(0,0,0,0.4)' : 'var(--text-muted)' }}>{time}</span>
                {isMine && <StatusIcon status={msg.status} />}
              </div>
            </>
          )}
        </div>

        {/* Reactions */}
        {reactionGroups.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 3 }}>
            {reactionGroups.map(({ emoji, count, mine }) => (
              <button
                key={emoji}
                style={{
                  ...s.reactionPill,
                  background: mine ? 'var(--accent)' : 'var(--bg-secondary)',
                  color: mine ? 'white' : 'var(--text-primary)',
                  border: mine ? 'none' : '1px solid var(--border)',
                }}
                onClick={() => onReact(emoji)}
                title={mine ? 'Убрать реакцию' : 'Добавить реакцию'}
              >
                {emoji} {count}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function groupReactions(reactions: { sender_key: string; emoji: string }[], myPk?: string) {
  const map = new Map<string, { count: number; mine: boolean }>()
  for (const r of reactions) {
    const entry = map.get(r.emoji) ?? { count: 0, mine: false }
    entry.count++
    if (r.sender_key === myPk) entry.mine = true
    map.set(r.emoji, entry)
  }
  return Array.from(map.entries()).map(([emoji, { count, mine }]) => ({ emoji, count, mine }))
}

// ─── Forward Dialog ────────────────────────────────────────────────────────────

function ForwardDialog({
  text, contacts, onClose, onForward
}: {
  text: string; contacts: Contact[]; onClose: () => void; onForward: (pk: string) => void
}) {
  const [search, setSearch] = useState('')
  const filtered = contacts.filter(c =>
    (c.local_alias ?? c.nickname).toLowerCase().includes(search.toLowerCase())
  )
  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>↗ Переслать сообщение</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div style={{
          background: 'var(--bg-primary)', borderRadius: 8, padding: '6px 8px',
          fontSize: 12, color: 'var(--text-muted)', marginBottom: 10,
          maxHeight: 60, overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {text.slice(0, 120)}{text.length > 120 ? '...' : ''}
        </div>
        <input
          style={{ ...s.textarea, minHeight: 32, marginBottom: 8 }}
          placeholder="Поиск контактов..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div style={{ maxHeight: 250, overflowY: 'auto' }}>
          {filtered.map(c => (
            <button
              key={c.public_key}
              style={s.forwardContact}
              onClick={() => onForward(c.public_key)}
            >
              <span style={s.forwardAvatar}>{(c.local_alias ?? c.nickname).charAt(0).toUpperCase()}</span>
              <span>{c.local_alias ?? c.nickname}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Контакты не найдены
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center', padding: '2px 4px' }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: '50%',
          background: 'var(--text-muted)',
          animation: `pulse 1.2s ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
  )
}

function StatusIcon({ status }: { status: string }) {
  return (
    <span style={{ fontSize: 10, color: status === 'read' ? 'var(--online)' : 'rgba(0,0,0,0.4)' }}>
      {status === 'sent' ? '✓' : '✓✓'}
    </span>
  )
}

function DateDivider({ date }: { date: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px 6px' }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{date}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  )
}

function groupByDate(messages: Message[]) {
  const map = new Map<string, Message[]>()
  for (const msg of messages) {
    const date = formatDate(msg.timestamp)
    if (!map.has(date)) map.set(date, [])
    map.get(date)!.push(msg)
  }
  return Array.from(map.entries()).map(([date, msgs]) => ({ date, msgs }))
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000)
  const now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diff === 0) return 'Сегодня'
  if (diff === 1) return 'Вчера'
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'long' })
}

function statusLabel(status: string, text?: string | null): React.ReactNode {
  if (text) return <span style={{ color: 'var(--text-muted)' }}>{text}</span>
  const map: Record<string, string> = {
    online: 'Онлайн', away: 'Отошёл', busy: 'Занят', offline: 'Не в сети'
  }
  return (
    <span style={{ color: status === 'online' ? 'var(--online)' : 'var(--text-muted)' }}>
      {map[status] ?? status}
    </span>
  )
}

const s: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', flexDirection: 'column',
    height: '100vh', background: 'var(--bg-primary)',
    position: 'relative',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 14px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg-secondary)', flexShrink: 0,
    boxShadow: '0 1px 4px var(--shadow)',
  },
  headerAvatar: {
    width: 38, height: 38, borderRadius: '50%',
    background: 'var(--accent)', color: 'white',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 700, fontSize: 17, position: 'relative',
    flexShrink: 0, cursor: 'pointer',
  },
  headerDot: {
    position: 'absolute', bottom: 0, right: 0,
    width: 11, height: 11, border: '2px solid var(--bg-secondary)', borderRadius: '50%',
  },
  headerInfo: { flex: 1 },
  headerName: { fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' },
  headerSub: { fontSize: 12, marginTop: 1 },
  headerActions: { display: 'flex', gap: 4 },
  messages: {
    flex: 1, overflowY: 'auto',
    display: 'flex', flexDirection: 'column',
    paddingTop: 8, paddingBottom: 8,
  },
  noMessages: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    padding: 40, marginTop: 60,
  },
  typingBubble: {
    background: 'var(--bubble-other)',
    border: '1px solid var(--border)',
    borderRadius: '16px 16px 16px 4px',
    padding: '8px 12px',
    boxShadow: '0 1px 3px var(--shadow)',
  },
  emojiPicker: {
    display: 'flex', flexWrap: 'wrap', gap: 2,
    padding: '8px', background: 'var(--bg-secondary)',
    borderTop: '1px solid var(--border)',
    maxHeight: 140, overflowY: 'auto',
    flexShrink: 0,
  },
  emojiBtn: {
    background: 'transparent', border: 'none',
    fontSize: 22, cursor: 'pointer',
    borderRadius: 6, padding: '3px',
    transition: 'background 0.1s',
  },
  inputArea: {
    display: 'flex', alignItems: 'flex-end', gap: 6,
    padding: '8px 10px',
    borderTop: '1px solid var(--border)',
    background: 'var(--bg-secondary)', flexShrink: 0,
  },
  textarea: {
    flex: 1, resize: 'none', maxHeight: 120, minHeight: 36,
    border: '1px solid var(--input-border)',
    borderRadius: 12, padding: '8px 12px',
    fontSize: 14, lineHeight: 1.4, overflowY: 'auto',
    overflowX: 'hidden',
    background: 'var(--bg-primary)', color: 'var(--text-primary)',
  },
  sendBtn: {
    width: 38, height: 38, padding: 0,
    borderRadius: 10, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 14, fontWeight: 700,
    transition: 'opacity 0.15s',
  },
  contextMenu: {
    position: 'fixed', zIndex: 1000,
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    boxShadow: '0 4px 16px var(--shadow)',
    minWidth: 170,
    overflow: 'hidden',
    padding: '4px 0',
  },
  contextReactions: {
    display: 'flex', gap: 2, padding: '6px 8px',
  },
  contextReactionBtn: {
    background: 'transparent', border: 'none',
    fontSize: 20, cursor: 'pointer',
    borderRadius: 6, padding: '2px 4px',
  },
  ctxDivider: {
    height: 1, background: 'var(--border)', margin: '2px 0',
  },
  ctxItem: {
    display: 'block', width: '100%', textAlign: 'left',
    padding: '7px 14px', fontSize: 13,
    background: 'transparent', border: 'none', cursor: 'pointer',
    color: 'var(--text-primary)',
  },
  reactBtn: {
    position: 'absolute', top: '50%', transform: 'translateY(-50%)',
    background: 'var(--bg-secondary)', border: '1px solid var(--border)',
    fontSize: 13, cursor: 'pointer', opacity: 0.7,
    borderRadius: '50%', padding: '2px 4px',
    zIndex: 1,
  },
  reactionPicker: {
    position: 'absolute', top: '100%', zIndex: 100,
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    boxShadow: '0 4px 16px var(--shadow)',
    padding: '6px',
    display: 'flex', flexWrap: 'wrap', gap: 2,
    maxWidth: 220, maxHeight: 200, overflowY: 'auto',
  },
  reactionPill: {
    border: 'none', borderRadius: 12,
    padding: '2px 8px', fontSize: 13,
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3,
  },
  modalOverlay: {
    position: 'fixed', inset: 0, zIndex: 2000,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    background: 'var(--bg-secondary)',
    borderRadius: 14, padding: 20, width: 340,
    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
  },
  forwardContact: {
    display: 'flex', alignItems: 'center', gap: 10,
    width: '100%', padding: '8px 10px',
    background: 'transparent', border: 'none',
    borderRadius: 8, cursor: 'pointer',
    fontSize: 14, color: 'var(--text-primary)',
    textAlign: 'left',
  },
  forwardAvatar: {
    width: 32, height: 32, borderRadius: '50%',
    background: 'var(--accent)', color: 'white',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 700, fontSize: 14, flexShrink: 0,
  },
}
