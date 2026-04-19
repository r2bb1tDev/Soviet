import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useStore, Chat, Message } from '../store'

interface SearchHit {
  chat: Chat
  message: Message
}

export default function GlobalSearch({ onClose }: { onClose: () => void }) {
  const { chats, contacts, openTab, loadMessages } = useStore()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)

  // Плоский кэш сообщений по всем чатам — лениво подгружаем по запросу
  const [allMessages, setAllMessages] = useState<Record<number, Message[]>>({})

  useEffect(() => {
    if (!query || query.length < 2) { setHits([]); return }
    let cancelled = false
    setLoading(true)

    ;(async () => {
      const nextCache = { ...allMessages }
      for (const chat of chats) {
        if (!nextCache[chat.id]) {
          try {
            const msgs = await invoke<Message[]>('get_messages', { chatId: chat.id, limit: 200, offset: 0 })
            nextCache[chat.id] = msgs
          } catch { nextCache[chat.id] = [] }
        }
      }
      if (cancelled) return
      setAllMessages(nextCache)

      const q = query.toLowerCase()
      const found: SearchHit[] = []
      for (const chat of chats) {
        const msgs = nextCache[chat.id] ?? []
        for (const m of msgs) {
          const text = (m.plaintext ?? m.content ?? '').toLowerCase()
          if (text.includes(q)) {
            found.push({ chat, message: m })
            if (found.length >= 100) break
          }
        }
        if (found.length >= 100) break
      }
      setHits(found)
      setLoading(false)
    })()

    return () => { cancelled = true }
  }, [query, chats])

  const getChatName = useMemo(() => (chat: Chat): string => {
    if (chat.chat_type === 'group') return chat.group_name ?? 'Группа'
    const c = contacts.find(c => c.public_key === chat.peer_key)
    return c?.local_alias ?? c?.nickname ?? (chat.peer_key?.slice(0, 12) ?? 'Чат')
  }, [contacts])

  const open = async (hit: SearchHit) => {
    openTab(hit.chat)
    try { await loadMessages(hit.chat.id) } catch {}
    onClose()
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: 80,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 560, maxHeight: '70vh', background: 'var(--bg-primary)',
          border: '1px solid var(--border)', borderRadius: 8,
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') onClose() }}
            placeholder="Поиск по всем чатам (мин. 2 символа)..."
            style={{
              width: '100%', background: 'var(--bg-secondary)',
              border: '1px solid var(--border)', color: 'var(--text-primary)',
              padding: '8px 10px', borderRadius: 4, fontSize: 14, outline: 'none',
            }}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
          {loading && <div style={{ padding: 12, color: 'var(--text-secondary)' }}>Поиск…</div>}
          {!loading && query.length >= 2 && hits.length === 0 && (
            <div style={{ padding: 12, color: 'var(--text-secondary)' }}>Ничего не найдено</div>
          )}
          {hits.map((h, i) => {
            const text = h.message.plaintext ?? h.message.content ?? ''
            const lc = text.toLowerCase()
            const qi = lc.indexOf(query.toLowerCase())
            const slice = qi >= 0
              ? text.slice(Math.max(0, qi - 30), qi + query.length + 50)
              : text.slice(0, 80)
            return (
              <div
                key={i}
                onClick={() => open(h)}
                style={{
                  padding: '8px 10px', cursor: 'pointer',
                  borderRadius: 4, borderBottom: '1px solid var(--border)',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 2 }}>
                  {getChatName(h.chat)}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                  …{slice}…
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {new Date(h.message.timestamp * 1000).toLocaleString('ru-RU')}
                </div>
              </div>
            )
          })}
        </div>
        <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-secondary)' }}>
          Esc — закрыть · Enter в результате — открыть чат
        </div>
      </div>
    </div>
  )
}
