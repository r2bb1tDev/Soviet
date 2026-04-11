import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useStore, Contact } from '../store'

interface Props {
  contact: Contact
  onClose: () => void
}

export default function ContactProfile({ contact, onClose }: Props) {
  const { loadContacts, deleteContact, setActiveChat, chats, setPage } = useStore()
  const [safetyNumber, setSafetyNumber] = useState('')
  const [alias, setAlias] = useState(contact.local_alias ?? '')
  const [notes, setNotes] = useState(contact.notes ?? '')
  const [isFavorite, setIsFavorite] = useState(contact.is_favorite)
  const [isBlocked, setIsBlocked] = useState(contact.is_blocked)
  const [saved, setSaved] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    invoke<string>('get_safety_number', { peerPk: contact.public_key })
      .then(setSafetyNumber)
      .catch(() => {})
  }, [contact.public_key])

  const save = async () => {
    await invoke('update_contact', {
      publicKey: contact.public_key,
      alias: alias.trim() || null,
      notes: notes.trim() || null,
      isFavorite,
      isBlocked,
    })
    await loadContacts()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleDelete = async () => {
    await deleteContact(contact.public_key)
    onClose()
  }

  const copyKey = () => {
    navigator.clipboard.writeText(contact.public_key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const openChat = () => {
    const chat = chats.find(c => c.chat_type === 'direct' && c.peer_key === contact.public_key)
    if (chat) {
      setActiveChat(chat)
    } else {
      setActiveChat({
        id: -1,
        chat_type: 'direct',
        peer_key: contact.public_key,
        group_id: null,
        created_at: Date.now() / 1000,
        last_message: null,
        last_message_time: null,
        unread_count: 0,
        group_name: null,
      })
    }
    setPage('main')
    onClose()
  }

  const displayName = contact.local_alias ?? contact.nickname

  return (
    <div style={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={s.modal} className="fade-in">
        {/* Шапка */}
        <div style={s.header}>
          <button className="btn-icon" onClick={onClose}>←</button>
          <span style={s.headerTitle}>Профиль контакта</span>
          <div />
        </div>

        {/* Аватар */}
        <div style={s.avatarSection}>
          <div style={s.avatar}>
            {contact.avatar_data
              ? <img src={contact.avatar_data} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
              : displayName.charAt(0).toUpperCase()
            }
            <span className={`status-dot ${contact.status}`} style={s.statusDot} />
          </div>
          <div style={s.name}>{displayName}</div>
          {contact.nickname !== displayName && (
            <div style={s.origName}>{contact.nickname}</div>
          )}
          {contact.status_text && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, fontStyle: 'italic' }}>
              "{contact.status_text}"
            </div>
          )}
          <div style={s.statusLabel}>
            {contact.verified && <span style={s.verifiedBadge}>✓ Верифицирован</span>}
            {contact.is_favorite && <span style={s.favBadge}>★ Избранное</span>}
          </div>
        </div>

        {/* Кнопки действий */}
        <div style={s.actions}>
          <button className="btn-primary" style={s.actionBtn} onClick={openChat}>
            💬 Написать
          </button>
        </div>

        <div style={s.body}>
          {/* Публичный ключ */}
          <Section title="Публичный ключ">
            <div style={s.keyRow}>
              <span style={s.keyText}>{contact.public_key}</span>
              <button className="btn-icon" onClick={copyKey} title="Копировать">
                {copied ? '✓' : '📋'}
              </button>
            </div>
          </Section>

          {/* Отображаемое имя */}
          <Section title="Отображаемое имя">
            <input
              style={s.input}
              placeholder={contact.nickname}
              value={alias}
              onChange={e => setAlias(e.target.value)}
            />
          </Section>

          {/* Заметки */}
          <Section title="Заметки">
            <textarea
              style={{ ...s.input, height: 64, resize: 'none' }}
              placeholder="Личные заметки о контакте..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </Section>

          {/* Переключатели */}
          <Section title="Параметры">
            <div style={s.toggleRow} onClick={() => setIsFavorite(v => !v)}>
              <span style={s.toggleLabel}>★ Избранное</span>
              <Toggle value={isFavorite} />
            </div>
            <div style={s.toggleRow} onClick={() => setIsBlocked(v => !v)}>
              <span style={{ ...s.toggleLabel, color: isBlocked ? 'var(--busy)' : 'var(--text-primary)' }}>
                🚫 Заблокировать
              </span>
              <Toggle value={isBlocked} color={isBlocked ? 'var(--busy)' : undefined} />
            </div>
          </Section>

          {/* Safety Number */}
          {safetyNumber && (
            <Section title="Safety Number">
              <p style={s.hint}>
                Сравните этот код с контактом для подтверждения безопасности канала
              </p>
              <div style={s.safetyNumber}>{safetyNumber}</div>
            </Section>
          )}

          {/* Кнопки */}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn-primary" style={{ flex: 1 }} onClick={save}>
              {saved ? '✓ Сохранено' : 'Сохранить'}
            </button>
          </div>

          {/* Удаление */}
          {!showDeleteConfirm ? (
            <button
              className="btn-secondary"
              style={{ width: '100%', marginTop: 8, color: 'var(--busy)' }}
              onClick={() => setShowDeleteConfirm(true)}
            >
              Удалить контакт
            </button>
          ) : (
            <div style={s.confirmDelete}>
              <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                Удалить {displayName}?
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn-secondary" style={{ flex: 1, fontSize: 12 }}
                  onClick={() => setShowDeleteConfirm(false)}>
                  Отмена
                </button>
                <button
                  style={{ flex: 1, fontSize: 12, background: 'var(--busy)', color: '#fff', borderRadius: 8, border: 'none', cursor: 'pointer' }}
                  onClick={handleDelete}>
                  Удалить
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 6 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Toggle({ value, color }: { value: boolean; color?: string }) {
  return (
    <div style={{
      width: 38, height: 22, borderRadius: 11, position: 'relative',
      background: value ? (color ?? 'var(--accent)') : 'var(--bg-tertiary)',
      transition: 'background 0.2s', flexShrink: 0,
    }}>
      <div style={{
        position: 'absolute', top: 2,
        width: 18, height: 18, borderRadius: 9,
        background: 'white', transition: 'transform 0.2s',
        transform: value ? 'translateX(18px)' : 'translateX(2px)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
      }} />
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 300,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    width: 380,
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', borderBottom: '1px solid var(--border)',
    background: 'var(--bg-secondary)', flexShrink: 0,
  },
  headerTitle: { fontSize: 15, fontWeight: 600 },
  avatarSection: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: '20px 20px 12px', flexShrink: 0,
    background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)',
  },
  avatar: {
    width: 60, height: 60, borderRadius: '50%',
    background: 'var(--accent)', color: 'white',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 28, fontWeight: 700, position: 'relative',
    marginBottom: 10,
  },
  statusDot: {
    position: 'absolute', bottom: 2, right: 2,
    width: 14, height: 14, border: '2px solid var(--bg-secondary)', borderRadius: '50%',
  },
  name: { fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' },
  origName: { fontSize: 12, color: 'var(--text-muted)', marginTop: 2 },
  statusLabel: { display: 'flex', gap: 6, marginTop: 6 },
  verifiedBadge: {
    fontSize: 11, color: 'var(--online)',
    background: 'rgba(76,175,80,0.12)', padding: '2px 8px', borderRadius: 10,
  },
  favBadge: {
    fontSize: 11, color: 'var(--away)',
    background: 'rgba(255,193,7,0.12)', padding: '2px 8px', borderRadius: 10,
  },
  actions: {
    display: 'flex', gap: 8, padding: '12px 16px',
    borderBottom: '1px solid var(--border)', flexShrink: 0,
    background: 'var(--bg-secondary)',
  },
  actionBtn: { flex: 1, fontSize: 13 },
  body: { flex: 1, overflowY: 'auto', padding: '16px' },
  keyRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'var(--bg-secondary)', borderRadius: 8,
    padding: '8px 10px', border: '1px solid var(--border)',
  },
  keyText: {
    fontFamily: 'monospace', fontSize: 11,
    color: 'var(--text-secondary)', flex: 1, wordBreak: 'break-all',
  },
  input: { width: '100%' },
  hint: { fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 },
  safetyNumber: {
    fontFamily: 'monospace', fontSize: 13, letterSpacing: '0.05em',
    color: 'var(--text-primary)', lineHeight: 1.8,
    background: 'var(--bg-secondary)', padding: '10px 12px',
    borderRadius: 8, border: '1px solid var(--border)',
    wordBreak: 'break-all',
  },
  toggleRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    cursor: 'pointer', padding: '7px 0',
  },
  toggleLabel: { fontSize: 14, color: 'var(--text-primary)' },
  confirmDelete: {
    display: 'flex', flexDirection: 'column', gap: 8,
    background: 'rgba(244,67,54,0.06)',
    border: '1px solid var(--busy)',
    borderRadius: 8, padding: '10px 12px',
    marginTop: 8,
  },
}
