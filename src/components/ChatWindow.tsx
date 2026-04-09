import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useStore, Message, Contact, Chat } from '../store'
import ContactProfile from './ContactProfile'

// Обёртка для loadMessages через store.getState()
const storeLoadMessages = async (chatId: number) => {
  const st = useStore.getState()
  return st.loadMessages(chatId)
}

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
    contacts, sendMessage, typingUsers, sendTyping,
    addReaction, removeReaction, editMessage, deleteMessage,
    leaveGroup, deleteGroup, getGroupMembers, deleteChat, setActiveChat,
    sendGroupMessage,
    loadMoreMessages,
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
  const textareaRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // В проекте уже есть события Tauri (`new-message`, `group-message`), поэтому
  // polling здесь не нужен и добавляет задержки/нагрузку.

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
    try { await leaveGroup(activeChat.group_id) } catch {}
  }

  const handleDeleteGroup = async () => {
    if (!activeChat?.group_id) return
    if (!confirm('Удалить группу для всех участников?')) return
    try { await deleteGroup(activeChat.group_id) } catch {}
  }

  const handleDeleteChat = async () => {
    if (!activeChat) return
    if (!confirm('Удалить этот чат?')) return
    try {
      await deleteChat(activeChat.id!)
      setActiveChat(null)
    } catch {}
  }

  // Получаем контакт для текущего чата (используем в хедерах и профиле)
  const contactForChat = activeChat ? contacts.find(c => c.public_key === activeChat.peer_key!) : null
  
  const groupName = isGroup
    ? activeChat?.group_name ?? `Группа (${groupMembers.length})`
    : null
  
  // Имя для отображения: nickname пользователя (без local_alias)
  const displayName = isGroup
    ? groupName!
    : contactForChat?.nickname
      ?? (activeChat?.peer_key ? activeChat.peer_key.slice(0, 12) + '...' : '')

  const avatarLetter = isGroup
    ? (groupName as string)?.charAt(0).toUpperCase() ?? 'G'
    : displayName.charAt(0).toUpperCase() ?? '?'

  const isTyping = activeChat?.peer_key ? (typingUsers[activeChat.peer_key] ?? false) : false

  // Автоскролл при новых сообщениях
  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  const handleLoadMore = async () => {
    if (!activeChat?.id || messages.length === 0) return
    const firstTs = messages[0]?.timestamp
    if (!firstTs) return
    try { await loadMoreMessages(activeChat.id, firstTs) } catch {}
  }

  // Очистка состояния при смене чата
  useEffect(() => {
    setText('')
    setSending(false)
    setShowEmoji(false)
    setEditingId(null)
    setContextMenu(null)
    textareaRef.current?.focus()
    
    // Загружаем сообщения нового чата сразу после активации
    if (activeChat?.id && activeChat.id > 0) {
      storeLoadMessages(activeChat.id).catch(() => {})
    }
  }, [activeChat?.id])

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
        if (ac && ac.id! > 0) storeLoadMessages(ac.id!)
      } catch {}
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleSend = useCallback(async () => {
    if (!text.trim() || !activeChat || sending) return
    setSending(true)
    
    // Отправляем сигнал "перестал печатать" перед отправкой
    if (activeChat.peer_key) sendTyping(activeChat.peer_key, false)
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    
    try {
      if (activeChat.chat_type === 'group') {
        if (!activeChat.group_id) return
        await sendGroupMessage(activeChat.group_id, text.trim())
      } else {
        if (!activeChat.peer_key) return
        await sendMessage(activeChat.peer_key, text.trim())
      }
      
      // После отправки перезагружаем сообщения для синхронизации
      const chatId = activeChat?.id ?? -1
      if (chatId > 0) {
        storeLoadMessages(chatId).catch(() => {})
      } else {
        // Используем store.getState() для получения chats после loadChats
        const st = useStore.getState()
        try {
          await new Promise<void>(resolve => {
            st.loadChats().then(() => {
              // После загрузки чатов ищем новый чат в store
              const chats = (st.chats as unknown as Chat[])
              const newChats: Chat[] = chats.filter(c => c.chat_type === 'direct' && c.peer_key === activeChat?.peer_key)
              if (newChats.length > 0) {
                // Обновляем activeChat на новый чат
                st.setActiveChat(newChats[0])
                storeLoadMessages(newChats[0].id!).catch(() => {})
              } else {
                // Если не нашли в direct, пробуем найти по peer_key в любом типе чата
                const found = chats.find(c => c.peer_key === activeChat?.peer_key)
                if (found) st.setActiveChat(found)
              }
              resolve()
            }).catch(() => { resolve() })
          }).then(() => {}, () => {})
        } catch {}
      }
      
      setText('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
    } catch {}
    finally {
      setSending(false)
      textareaRef.current?.focus()
    }
  }, [text, activeChat, sending, sendMessage, sendGroupMessage])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
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
    try { await editMessage(editingId!, activeChat.id!, editText) } catch {}
    setEditingId(null)
  }

  const handleDelete = async (msgId: number) => {
    if (!activeChat) return
    if (!confirm('Удалить это сообщение?')) return
    setContextMenu(null)
    try { await deleteMessage(msgId, activeChat.id!) } catch {}
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
      if (existing) await removeReaction(msgId, activeChat.id!, emoji)
      else await addReaction(msgId, activeChat.id!, emoji)
    } catch {}
    setReactionPickerMsgId(null)
    setContextMenu(null)
  }

  // Группируем сообщения по датам для отображения разделителей
  const grouped = groupByDate(messages)

  if (!activeChat) return null

  return (
    <div style={s.root} onClick={() => setShowEmoji(false)}>
      {/* ── Header ── */}
      <div style={s.header}>
        <div
          style={s.headerAvatar}
          onClick={() => !isGroup && contactForChat && setShowProfile(true)}
        >
          {avatarLetter}
          {!isGroup && contactForChat && (
            <span className={`status-dot ${contactForChat.status}`} style={s.headerDot} />
          )}
        </div>

          <div style={s.headerInfo}>
            <div style={s.headerName}>{displayName}</div>
            <div style={s.headerSub}>
              {isGroup
                ? <span>{groupMembers.length} участн.</span>
                : isTyping
                  ? <span style={{ color: 'var(--online)', fontStyle: 'italic' }}>печатает...</span>
                  : contactForChat
                    ? statusLabel(contactForChat.status, contactForChat.status_text)
                    : activeChat?.peer_key
                      ? <span>{activeChat.peer_key.slice(0, 24)}…</span>
                      : <span>неизвестно</span>
              }
            </div>
          </div>

        <div style={s.headerActions}>
          {!isGroup && contactForChat && (
            <button className="btn-icon" title="Профиль" onClick={() => setShowProfile(true)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </button>
          )}
          {!isGroup && (
            <button className="btn-icon" title="Удалить чат"
              style={{ color: '#e53e3e' }} onClick={handleDeleteChat}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
                <path d="M9 6V4h6v2"/>
              </svg>
            </button>
          )}
          {isGroup && (
            <>
              <button className="btn-icon" title="Покинуть группу" onClick={handleLeaveGroup}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
              </button>
              {isGroupAdmin && (
                <button className="btn-icon" title="Удалить группу"
                  style={{ color: '#e53e3e' }} onClick={handleDeleteGroup}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Message list ── */}
      <div style={s.messages}>
        {messages.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 10px' }}>
            <button className="btn-secondary" style={{ fontSize: 12, padding: '6px 10px' }} onClick={handleLoadMore}>
              Показать историю
            </button>
          </div>
        )}
        {messages.length === 0 && (
          <div style={s.noMessages}>
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none"
              stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" style={{ marginBottom: 12 }}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center', lineHeight: 1.5 }}>
              Сообщения зашифрованы E2E.<br />Напишите первое сообщение!
            </div>
          </div>
        )}

        {grouped.map(({ date, msgs }) => (
          <div key={date}>
            {/* Date separator */}
            <div className="date-separator"><span>{date}</span></div>

            {msgs.map(msg => {
              if (msg.content_type === 'system') {
                return (
                  <div key={msg.id} style={s.systemMsg}>
                    {msg.content}
                  </div>
                )
              }
              const isMine = msg.sender_key === identity?.public_key
              const msgText = decryptedMessages[msg.id] ?? ''
              const msgReactions = reactions[msg.id] ?? []
              return (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  isMine={isMine}
                  text={msgText}
                  msgReactions={msgReactions}
                  myPk={identity?.public_key ?? ''}
                  isEditing={editingId === msg.id}
                  editText={editText}
                  onEditChange={setEditText}
                  onEditSubmit={submitEdit}
                  onEditCancel={() => setEditingId(null)}
                  onContextMenu={(e) => handleRightClick(e, msg, isMine, msgText)}
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

      {/* ── Compose bar ── */}
      <div style={s.composeBar}>
        <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileSelect} />

        <button className="btn-icon" title="Прикрепить файл" style={s.composeBtn}
          onClick={() => fileInputRef.current?.click()}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
          </svg>
        </button>

        <button className="btn-icon" title="Emoji" style={s.composeBtn}
          onClick={e => { e.stopPropagation(); setShowEmoji(v => !v) }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/>
            <line x1="15" y1="9" x2="15.01" y2="9"/>
          </svg>
        </button>

        <button className="btn-icon" title="Вставить блок кода" style={{ ...s.composeBtn, fontFamily: 'monospace', fontSize: 13, fontWeight: 700, width: 34, height: 34 }}
          onClick={() => {
            const ta = textareaRef.current as HTMLTextAreaElement | null
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
          }}>
          {'</>'}
        </button>

        <div style={s.textareaWrap}>
          <textarea
            ref={textareaRef as any}
            style={s.textarea}
            placeholder="Сообщение"
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            rows={1}
          />
        </div>

        <button
          style={{
            ...s.sendBtn,
            background: text.trim() ? 'var(--accent)' : 'var(--bg-tertiary)',
            color: text.trim() ? '#fff' : 'var(--text-muted)',
          }}
          onClick={handleSend}
          disabled={!text.trim() || sending}
          title="Отправить"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>

      {/* ── Context menu ── */}
      {contextMenu && (
        <div
          style={{
            ...s.contextMenu,
            left: Math.min(contextMenu.x, window.innerWidth - 190),
            top: Math.min(contextMenu.y, window.innerHeight - 210),
          }}
          onClick={e => e.stopPropagation()}
        >
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
          }}>Копировать</button>
          <button style={s.ctxItem} onClick={() => handleForward(contextMenu.text)}>Переслать</button>
          {/* Кнопки контекстного меню */}
          {contextMenu.isMine && (
            <>
              <button style={s.ctxItem} onClick={() => startEdit(contextMenu.msgId, contextMenu.text)}>
                Редактировать
              </button>
              {!messages.find(m => m.id === contextMenu.msgId)?.is_deleted && (
                <button style={{ ...s.ctxItem, color: '#e53e3e' }}
                  onClick={() => handleDelete(contextMenu.msgId)}>
                  Удалить
                </button>
              )}
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

      {showProfile && contactForChat && (
        <ContactProfile contact={contactForChat} onClose={() => setShowProfile(false)} />
      )}
    </div>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function renderMessageText(text: string): React.ReactNode {
  const nodes: React.ReactNode[] = []
  const fencedRe = /```([^\n]*)\n?([\s\S]*?)```/g
  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = fencedRe.exec(text)) !== null) {
    if (match.index > last) nodes.push(...renderInlineCode(text.slice(last, match.index), key++))
    nodes.push(
      <pre key={key++} style={{
        background: 'rgba(0,0,0,0.08)', border: '1px solid rgba(0,0,0,0.10)',
        borderRadius: 6, padding: '8px 10px', margin: '4px 0',
        fontSize: 12, fontFamily: 'monospace', overflowX: 'auto',
        whiteSpace: 'pre', color: 'inherit',
      }}>
        <code>{match[2]}</code>
      </pre>
    )
    last = match.index + match[0].length
  }
  if (last < text.length) nodes.push(...renderInlineCode(text.slice(last), key++))
  return <>{nodes}</>
}

function renderInlineCode(text: string, baseKey: number): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={baseKey + '-' + i} style={{
          background: 'rgba(0,0,0,0.10)', borderRadius: 3,
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
  const reactionGroups = groupReactions(msgReactions, myPk)

  let fileContent: { file_name?: string; mime_type?: string; data?: string } | null = null
  if ((msg.content_type === 'file' || msg.content_type === 'image') && !msg.is_deleted && msg.edited_at === null) {
    try { fileContent = JSON.parse(text) } catch {}
  }

  const isImage = fileContent?.mime_type?.startsWith('image/') && fileContent.data
  const isFile  = fileContent?.file_name && !isImage

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: isMine ? 'flex-end' : 'flex-start',
      marginBottom: 2,
      padding: '0 12px',
      position: 'relative',
    }}>
      <div style={{ position: 'relative', maxWidth: 460 }}>
        {/* Hover react button */}
        <button
          style={{
            ...s.reactBtn,
            ...(isMine ? { right: '100%', marginRight: 4 } : { left: '100%', marginLeft: 4 }),
          }}
          onClick={onToggleReactionPicker}
          title="Реакция"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
            <line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
          </svg>
        </button>

        {/* Reaction picker — рендерим в portal чтобы не вылезало за окно */}
        {showReactionPicker && (
          <div style={{
            ...s.reactionPicker,
            position: 'fixed',
            bottom: 'auto',
            zIndex: 9000,
            ...(isMine ? { right: 16 } : { left: 16 }),
            top: '50%',
            transform: 'translateY(-50%)',
            maxWidth: 240,
            maxHeight: '60vh',
            overflowY: 'auto',
          }} onClick={e => e.stopPropagation()}>
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
            background: isMine ? 'var(--bubble-out-bg)' : 'var(--bubble-in-bg)',
            color: isMine ? 'var(--bubble-out-text)' : 'var(--bubble-in-text)',
            borderRadius: isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
            padding: isImage ? 4 : '8px 12px 22px',
            boxShadow: '0 1px 2px var(--shadow)',
            wordBreak: 'break-word',
            cursor: 'default',
            overflow: 'hidden',
            opacity: msg.is_deleted ? 0.6 : 1,
            position: 'relative',
            minWidth: 60,
          }}
          onContextMenu={onContextMenu}
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
          ) : isImage ? (
            <>
              <img
                src={`data:${fileContent!.mime_type};base64,${fileContent!.data}`}
                style={{ maxWidth: 280, maxHeight: 280, borderRadius: 14, display: 'block' }}
                alt={fileContent!.file_name}
              />
              <div style={{ padding: '4px 6px 2px', fontSize: 11, display: 'flex', justifyContent: 'flex-end', gap: 4,
                color: isMine ? 'var(--bubble-out-meta)' : 'var(--bubble-in-meta)' }}>
                <span>{time}</span>
                {isMine && <StatusIcon status={msg.status} />}
              </div>
            </>
          ) : isFile ? (
            <>
              <a href={fileContent!.data ? `data:${fileContent!.mime_type};base64,${fileContent!.data}` : '#'}
                download={fileContent!.file_name}
                style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: 'inherit', padding: '2px 0' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                </svg>
                <span style={{ fontSize: 13, flex: 1 }}>{fileContent!.file_name}</span>
              </a>
              {/* meta inside bubble — positioned at bottom */}
              <div className="bubble-meta" style={{ color: isMine ? 'var(--bubble-out-meta)' : 'var(--bubble-in-meta)' }}>
                <span>{time}</span>
                {isMine && <StatusIcon status={msg.status} />}
              </div>
            </>
          ) : (
            <>
              <div style={{
                fontSize: 14, lineHeight: 1.45,
                fontStyle: msg.is_deleted ? 'italic' : 'normal',
                color: msg.is_deleted ? 'var(--text-muted)' : undefined,
              }}>
                {text
                  ? renderMessageText(text)
                  : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>расшифровка...</span>
                }
              </div>
              {/* Meta overlay — bottom right */}
              <div className="bubble-meta" style={{ color: isMine ? 'var(--bubble-out-meta)' : 'var(--bubble-in-meta)' }}>
                {msg.edited_at && !msg.is_deleted && (
                  <span style={{ fontSize: 10, opacity: 0.8 }}>изм.</span>
                )}
                <span>{time}</span>
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
                  color: mine ? '#fff' : 'var(--text-primary)',
                  border: mine ? 'none' : '1px solid var(--border)',
                }}
                onClick={() => onReact(emoji)}
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

// ─── Helpers ───────────────────────────────────────────────────────────────────

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
          <span style={{ fontWeight: 700, fontSize: 15 }}>Переслать сообщение</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div style={{
          background: 'var(--bg-secondary)', borderRadius: 8, padding: '6px 10px',
          fontSize: 12, color: 'var(--text-muted)', marginBottom: 10,
          maxHeight: 60, overflow: 'hidden',
        }}>
          {text.slice(0, 120)}{text.length > 120 ? '...' : ''}
        </div>
        <input
          style={{ width: '100%', marginBottom: 8 }}
          placeholder="Поиск контактов..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          {filtered.map(c => (
            <button key={c.public_key} style={s.forwardContact} onClick={() => onForward(c.public_key)}>
              <span style={s.forwardAvatar}>{(c.local_alias ?? c.nickname).charAt(0).toUpperCase()}</span>
              <span>{c.local_alias ?? c.nickname}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Контакты не найдены
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '4px 2px' }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 7, height: 7, borderRadius: '50%',
          background: 'var(--bubble-in-meta)',
          animation: `pulse 1.2s ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
  )
}

function StatusIcon({ status }: { status: string }) {
  const isRead = status === 'read'
  return (
    <span className={`bubble-tick ${isRead ? 'read' : 'unread'}`}>
      <svg viewBox="0 0 16 11" fill="none">
        {status !== 'sent'
          ? <>
              <path d="M1 5.5L5.5 10L15 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M4 5.5L8.5 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </>
          : <path d="M1 5.5L5.5 10L15 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        }
      </svg>
    </span>
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
  if (text) return <span>{text}</span>
  const map: Record<string, string> = {
    online: 'в сети', away: 'отошёл', busy: 'занят', offline: 'не в сети'
  }
  return (
    <span style={{ color: status === 'online' ? 'var(--online)' : undefined }}>
      {map[status] ?? status}
    </span>
  )
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', flexDirection: 'column',
    height: '100vh',
    background: 'var(--bg-chat)',
    position: 'relative',
    flex: 1, minWidth: 0,
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 14px',
    borderBottom: '1px solid var(--divider)',
    background: 'var(--header-bg)',
    flexShrink: 0,
    boxShadow: '0 1px 3px var(--shadow)',
    zIndex: 10,
  },
  headerAvatar: {
    width: 40, height: 40, borderRadius: '50%',
    background: 'var(--accent)', color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 700, fontSize: 17, position: 'relative',
    flexShrink: 0, cursor: 'pointer', userSelect: 'none',
  },
  headerDot: {
    position: 'absolute', bottom: 1, right: 1,
    width: 11, height: 11,
    border: '2px solid var(--header-bg)',
    borderRadius: '50%',
  },
  headerInfo: { flex: 1, minWidth: 0 },
  headerName: {
    fontSize: 15, fontWeight: 700,
    color: 'var(--header-text)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  headerSub: {
    fontSize: 12, marginTop: 1,
    color: 'var(--header-sub)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  headerActions: { display: 'flex', gap: 2, flexShrink: 0 },
  messages: {
    flex: 1, overflowY: 'auto',
    display: 'flex', flexDirection: 'column',
    paddingTop: 12, paddingBottom: 8,
  },
  noMessages: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    padding: 40, marginTop: 60,
  },
  systemMsg: {
    textAlign: 'center', padding: '4px 16px',
    fontSize: 12, color: 'rgba(255,255,255,0.6)',
    fontStyle: 'italic',
  },
  typingBubble: {
    background: 'var(--bubble-in-bg)',
    borderRadius: '18px 18px 18px 4px',
    padding: '10px 14px',
    boxShadow: '0 1px 2px var(--shadow)',
  },
  emojiPicker: {
    display: 'flex', flexWrap: 'wrap', gap: 2,
    padding: '10px 12px',
    background: 'var(--header-bg)',
    borderTop: '1px solid var(--divider)',
    maxHeight: 148, overflowY: 'auto',
    flexShrink: 0,
  },
  emojiBtn: {
    background: 'transparent', border: 'none',
    fontSize: 22, cursor: 'pointer',
    borderRadius: 6, padding: '3px',
  },
  composeBar: {
    display: 'flex', alignItems: 'flex-end', gap: 6,
    padding: '8px 10px 10px',
    background: 'var(--header-bg)',
    borderTop: '1px solid var(--divider)',
    flexShrink: 0,
  },
  composeBtn: { width: 36, height: 36, flexShrink: 0 },
  textareaWrap: {
    flex: 1, minWidth: 0,
    background: 'var(--input-compose-bg)',
    border: '1px solid var(--input-border)',
    borderRadius: 20,
    padding: '6px 14px',
    display: 'flex', alignItems: 'center',
  },
  textarea: {
    flex: 1, resize: 'none', maxHeight: 120, minHeight: 22,
    background: 'transparent', border: 'none', outline: 'none',
    fontSize: 14, fontFamily: 'inherit',
    color: 'var(--text-primary)',
    lineHeight: 1.45,
    width: '100%',
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: '50%',
    border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
    transition: 'background 0.15s',
  },
  reactBtn: {
    position: 'absolute', top: '50%', transform: 'translateY(-50%)',
    background: 'var(--bg-secondary)', border: '1px solid var(--border)',
    borderRadius: '50%', width: 28, height: 28,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', opacity: 0, transition: 'opacity 0.15s',
    color: 'var(--text-secondary)',
    zIndex: 2,
  },
  reactionPicker: {
    position: 'absolute', bottom: '100%', zIndex: 100,
    background: 'var(--bg-primary)', border: '1px solid var(--border)',
    borderRadius: 12, padding: '8px',
    boxShadow: '0 4px 20px var(--shadow-md)',
    display: 'flex', flexWrap: 'wrap', gap: 2, maxWidth: 220,
  },
  reactionPill: {
    borderRadius: 10, padding: '2px 7px', fontSize: 13,
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3,
  },
  contextMenu: {
    position: 'fixed', zIndex: 9999,
    background: 'var(--bg-primary)', border: '1px solid var(--border)',
    borderRadius: 12, padding: '6px 0',
    boxShadow: '0 4px 24px var(--shadow-md)',
    minWidth: 180,
  },
  contextReactions: {
    display: 'flex', gap: 2, padding: '6px 8px',
  },
  contextReactionBtn: {
    background: 'transparent', border: 'none',
    fontSize: 22, cursor: 'pointer', borderRadius: 6, padding: '3px',
  },
  ctxDivider: { height: 1, background: 'var(--divider)', margin: '2px 0' },
  ctxItem: {
    display: 'block', width: '100%', textAlign: 'left',
    padding: '9px 16px', background: 'none', border: 'none',
    cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)',
  },
  modalOverlay: {
    position: 'fixed', inset: 0, zIndex: 9000,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    background: 'var(--bg-primary)', borderRadius: 16,
    padding: '20px', width: 360, maxHeight: '80vh',
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 8px 40px rgba(0,0,0,0.3)',
  },
  forwardContact: {
    display: 'flex', alignItems: 'center', gap: 10,
    width: '100%', padding: '9px 12px',
    background: 'transparent', border: 'none',
    cursor: 'pointer', borderRadius: 8,
    fontSize: 13, color: 'var(--text-primary)',
    textAlign: 'left',
  },
  forwardAvatar: {
    width: 34, height: 34, borderRadius: '50%',
    background: 'var(--accent)', color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 700, fontSize: 14, flexShrink: 0,
  },
}
