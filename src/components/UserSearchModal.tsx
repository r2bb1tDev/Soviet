import { useState, useMemo } from 'react'
import { useStore, Contact, LanPeer, P2pPeer } from '../store'
import BearLogo from './BearLogo'

interface Props {
  onClose: () => void
  onAddContact: (prefill: { pk: string; nick: string }) => void
}

interface SearchResult {
  pk: string
  nick: string
  source: 'contact' | 'lan' | 'p2p'
  isContact: boolean
}

export default function UserSearchModal({ onClose, onAddContact }: Props) {
  const { contacts, lanPeers, p2pPeers, identity } = useStore()
  const [query, setQuery] = useState('')

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase().replace(/^@/, '')
    if (!q || q.length < 2) return []

    const seen = new Set<string>()
    const out: SearchResult[] = []
    const myPk = identity?.public_key ?? ''

    const contactPks = new Set(contacts.map((c: Contact) => c.public_key))

    const push = (pk: string, nick: string, source: SearchResult['source']) => {
      if (pk === myPk || seen.has(pk)) return
      seen.add(pk)
      out.push({ pk, nick, source, isContact: contactPks.has(pk) })
    }

    // Поиск по контактам
    contacts.forEach((c: Contact) => {
      const name = (c.local_alias ?? c.nickname).toLowerCase()
      if (name.includes(q) || c.public_key.toLowerCase().includes(q)) {
        push(c.public_key, c.local_alias ?? c.nickname, 'contact')
      }
    })

    // Поиск по LAN-пирам
    lanPeers.forEach((p: LanPeer) => {
      if (p.nickname.toLowerCase().includes(q) || p.public_key.toLowerCase().includes(q)) {
        push(p.public_key, p.nickname, 'lan')
      }
    })

    // Поиск по P2P-пирам
    p2pPeers.forEach((p: P2pPeer) => {
      if (!p.soviet_pk) return
      if (p.peer_id.toLowerCase().includes(q) || p.soviet_pk.toLowerCase().includes(q)) {
        push(p.soviet_pk, p.peer_id.slice(0, 12) + '…', 'p2p')
      }
    })

    return out
  }, [query, contacts, lanPeers, p2pPeers, identity])

  const sourceLabel = (s: SearchResult['source']) => {
    if (s === 'contact') return { text: 'контакт', color: 'var(--accent)' }
    if (s === 'lan') return { text: 'LAN', color: 'var(--online)' }
    return { text: 'P2P', color: '#9b59b6' }
  }

  return (
    <div style={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={s.modal} className="fade-in">
        <div style={s.header}>
          <span style={s.title}>Поиск пользователей</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        <input
          style={s.input}
          placeholder="Никнейм, @id или публичный ключ..."
          value={query}
          autoFocus
          onChange={e => setQuery(e.target.value)}
        />

        <div style={s.list}>
          {query.trim().length < 2 && (
            <div style={s.empty}>Введите минимум 2 символа для поиска</div>
          )}
          {query.trim().length >= 2 && results.length === 0 && (
            <div style={s.empty}>Никого не найдено среди контактов и известных пиров</div>
          )}
          {results.map(r => {
            const lbl = sourceLabel(r.source)
            return (
              <div key={r.pk} style={s.row}>
                <div style={s.avatar}>
                  <BearLogo size={36} />
                </div>
                <div style={s.info}>
                  <div style={s.name}>{r.nick}</div>
                  <div style={s.pk}>{r.pk.slice(0, 16)}…</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ ...s.badge, color: lbl.color, borderColor: lbl.color }}>{lbl.text}</span>
                  {!r.isContact && (
                    <button className="btn-primary" style={s.addBtn}
                      onClick={() => { onAddContact({ pk: r.pk, nick: r.nick }); onClose() }}>
                      + Добавить
                    </button>
                  )}
                  {r.isContact && (
                    <span style={s.alreadyAdded}>✓ в контактах</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 400,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: 16, padding: '20px 24px',
    width: 420, maxHeight: '80vh',
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: { fontSize: 17, fontWeight: 700 },
  input: { width: '100%', marginBottom: 12 },
  list: { flex: 1, overflowY: 'auto' },
  empty: {
    textAlign: 'center', color: 'var(--text-muted)',
    fontSize: 13, padding: '32px 0',
  },
  row: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 0',
    borderBottom: '1px solid var(--border)',
  },
  avatar: {
    width: 36, height: 36, borderRadius: '50%',
    background: 'var(--bg-secondary)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, overflow: 'hidden',
    border: '1px solid var(--border)',
  },
  info: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' },
  pk: { fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 2 },
  badge: {
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
    border: '1px solid', borderRadius: 5, padding: '1px 6px',
    flexShrink: 0,
  },
  addBtn: { fontSize: 12, padding: '4px 12px' },
  alreadyAdded: { fontSize: 12, color: 'var(--text-muted)' },
}
