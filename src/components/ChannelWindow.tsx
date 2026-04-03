import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'

function shortPk(pk: string) {
  return pk.length >= 8 ? `${pk.slice(0, 6)}…${pk.slice(-4)}` : pk
}
function formatTime(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
}
function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('ru', { day: 'numeric', month: 'long' })
}

export default function ChannelWindow() {
  const {
    activeChannel, channelMessages, sendChannelMessage,
    nostrPubkey, addChannelMessage, leaveChannel, loadChannels,
    setActiveChannel, updateChannelMeta, deleteChannel, getSubscriberCount,
  } = useStore()

  const [subscriberCount, setSubscriberCount] = useState(0)
  useEffect(() => {
    if (!activeChannel) return
    getSubscriberCount(activeChannel.channel_id).then(setSubscriberCount).catch(() => {})
  }, [activeChannel?.channel_id])

  const isCreator = !!nostrPubkey && !!activeChannel && activeChannel.creator_pubkey === nostrPubkey

  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const channelTextareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [channelMessages])

  if (!activeChannel) {
    return (
      <div style={s.empty}>
        <div style={{ fontSize: 48 }}>📡</div>
        <div style={s.emptyText}>Выберите канал</div>
        <div style={s.emptyHint}>Каналы работают через Nostr — децентрализованную сеть</div>
      </div>
    )
  }

  const send = async () => {
    const t = text.trim()
    if (!t || sending) return
    setText('')
    setSending(true)
    try {
      await sendChannelMessage(activeChannel.channel_id, t)
      addChannelMessage({
        id: -Date.now(),
        event_id: '',
        channel_id: activeChannel.channel_id,
        sender_pubkey: nostrPubkey ?? '',
        sender_name: null,
        content: t,
        timestamp: Math.floor(Date.now() / 1000),
        reply_to: null,
        is_mine: true,
      })
    } catch (e) {
      console.error(e)
    } finally {
      setSending(false)
    }
  }

  const handleLeave = async () => {
    if (!confirm(`Покинуть канал «${activeChannel.name || activeChannel.channel_id.slice(0, 12)}»?`)) return
    try {
      await leaveChannel(activeChannel.channel_id)
      setActiveChannel(null)
      loadChannels()
    } catch (e) { console.error(e) }
  }

  const handleDelete = async () => {
    if (!confirm(`Удалить канал «${activeChannel.name || activeChannel.channel_id.slice(0, 12)}» для всех подписчиков?`)) return
    try {
      await deleteChannel(activeChannel.channel_id)
      setActiveChannel(null)
      loadChannels()
    } catch (e) { console.error(e) }
  }

  const lastEnterRef = useRef<number>(0)
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const now = Date.now()
      if (now - lastEnterRef.current < 400) {
        lastEnterRef.current = 0
        send()
      } else {
        lastEnterRef.current = now
      }
    }
  }

  let lastDate = ''

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <ChannelAvatar channel={activeChannel} size={36} />
        <div style={s.headerInfo}>
          <div style={s.channelName}>{activeChannel.name || 'Канал'}</div>
          <div style={s.channelId}>
            {subscriberCount > 0 ? `${subscriberCount} подписч. · ` : ''}ID: {activeChannel.channel_id.slice(0, 16)}…
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
        {channelMessages.length === 0 && (
          <div style={s.emptyMessages}>Нет сообщений. Напишите первым!</div>
        )}
        {channelMessages.map((msg) => {
          const dateStr = formatDate(msg.timestamp)
          const showDate = dateStr !== lastDate
          lastDate = dateStr
          return (
            <div key={msg.event_id || msg.id}>
              {showDate && <div style={s.dateSep}>{dateStr}</div>}
              <div style={{ ...s.msg, flexDirection: msg.is_mine ? 'row-reverse' : 'row' }}>
                {!msg.is_mine && (
                  <div style={s.senderAvatar}>
                    {(msg.sender_name?.[0] ?? msg.sender_pubkey[0] ?? '?').toUpperCase()}
                  </div>
                )}
                <div style={{ maxWidth: '70%' }}>
                  {!msg.is_mine && (
                    <div style={s.senderName}>{msg.sender_name ?? shortPk(msg.sender_pubkey)}</div>
                  )}
                  <div style={{
                    ...s.bubble,
                    background: msg.is_mine ? 'var(--accent)' : 'var(--bg-secondary)',
                    color: msg.is_mine ? 'white' : 'var(--text-primary)',
                    borderRadius: msg.is_mine ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                  }}>
                    <div style={{ fontSize: 14, lineHeight: 1.45 }}>{renderChannelText(msg.content)}</div>
                    <span style={{ ...s.time, color: msg.is_mine ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)' }}>
                      {formatTime(msg.timestamp)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {isCreator ? (
        <div style={s.inputRow}>
          <button
            className="btn-icon"
            title="Вставить блок кода (```)"
            style={{ fontSize: 13, flexShrink: 0, fontFamily: 'monospace', fontWeight: 700 }}
            onClick={() => {
              const ta = channelTextareaRef.current
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
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <textarea
              ref={channelTextareaRef}
              style={s.textarea}
              placeholder="Сообщение в канал..."
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKey}
              rows={1}
              maxLength={1000}
            />
            {text.length > 800 && (
              <div style={{ fontSize: 10, color: text.length >= 1000 ? 'var(--error,#e53e3e)' : 'var(--text-muted)', textAlign: 'right', paddingRight: 4 }}>
                {text.length}/1000
              </div>
            )}
          </div>
          <button className="btn-primary" style={s.sendBtn} onClick={send} disabled={!text.trim() || sending}>
            ➤
          </button>
        </div>
      ) : (
        <div style={{ ...s.inputRow, justifyContent: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
            Только создатель канала может писать сообщения
          </span>
        </div>
      )}

      {/* Settings modal */}
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

// ─── renderChannelText — code blocks + inline code ────────────────────────────

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

// ─── ChannelAvatar ─────────────────────────────────────────────────────────────

function ChannelAvatar({ channel, size }: { channel: { name: string; picture: string }; size: number }) {
  if (channel.picture && channel.picture.startsWith('data:')) {
    return (
      <img
        src={channel.picture}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
        alt=""
      />
    )
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

// ─── ChannelSettingsModal ──────────────────────────────────────────────────────

function ChannelSettingsModal({
  channel, onClose, onSave, isCreator, onDelete,
}: {
  channel: { name: string; about: string; picture: string }
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

        {/* Avatar picker */}
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

// ─── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', flex: 1, height: '100vh', overflow: 'hidden' },
  empty: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 12,
    color: 'var(--text-muted)',
  },
  emptyText: { fontSize: 18, fontWeight: 600, color: 'var(--text-secondary)' },
  emptyHint: { fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', maxWidth: 280 },
  header: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 14px', borderBottom: '1px solid var(--border)',
    background: 'var(--bg-secondary)', flexShrink: 0,
  },
  headerInfo: { flex: 1, minWidth: 0 },
  channelName: { fontWeight: 600, fontSize: 15 },
  channelId: { fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' },
  nostrBadge: {
    fontSize: 11, background: 'rgba(128,0,255,0.12)',
    color: '#9b59b6', borderRadius: 6, padding: '2px 8px',
    border: '1px solid rgba(128,0,255,0.2)', fontWeight: 600, flexShrink: 0,
  },
  messages: { flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 4 },
  emptyMessages: { textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, marginTop: 40 },
  dateSep: { textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', margin: '12px 0 4px', fontWeight: 500 },
  msg: { display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 4 },
  senderAvatar: {
    width: 28, height: 28, borderRadius: '50%',
    background: 'var(--accent)', color: 'white',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, fontWeight: 700, flexShrink: 0,
  },
  senderName: { fontSize: 11, color: 'var(--text-muted)', marginBottom: 2, paddingLeft: 4 },
  bubble: {
    padding: '8px 12px', borderRadius: 16,
    fontSize: 14, lineHeight: 1.5, wordBreak: 'break-word',
    display: 'flex', flexDirection: 'column', gap: 2,
  },
  time: { fontSize: 10, alignSelf: 'flex-end', marginTop: 2 },
  inputRow: {
    display: 'flex', gap: 8, padding: '10px 12px',
    borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)', flexShrink: 0,
  },
  textarea: {
    flex: 1, resize: 'none', borderRadius: 20,
    padding: '8px 14px', fontSize: 14, lineHeight: 1.4,
    maxHeight: 120, overflowY: 'auto',
    background: 'var(--bg-primary)', color: 'var(--text-primary)',
    border: '1px solid var(--input-border)',
  },
  sendBtn: { borderRadius: '50%', width: 40, height: 40, padding: 0, fontSize: 16, flexShrink: 0 },
}

const ms: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 2000,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    background: 'var(--bg-secondary)', borderRadius: 14,
    padding: 24, width: 360, boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
    display: 'flex', flexDirection: 'column', gap: 4,
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  label: { fontSize: 12, color: 'var(--text-muted)' },
  input: {
    padding: '8px 12px', borderRadius: 10, fontSize: 14,
    border: '1px solid var(--input-border)',
    background: 'var(--bg-primary)', color: 'var(--text-primary)',
    outline: 'none', width: '100%', boxSizing: 'border-box' as const,
  },
}
