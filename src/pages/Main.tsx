import { useState, useRef, useCallback } from 'react'
import { useStore } from '../store'
import Sidebar from '../components/Sidebar'
import ChatWindow from '../components/ChatWindow'
import ChannelWindow from '../components/ChannelWindow'
import AddContactModal from '../components/AddContactModal'
import CreateChannelModal from '../components/CreateChannelModal'
import CreateGroupModal from '../components/CreateGroupModal'
import BearLogo from '../components/BearLogo'

const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 420
const SIDEBAR_DEFAULT = 260

export default function Main() {
  const { activeChat, activeChannel } = useStore()
  const [addContactPrefill, setAddContactPrefill] = useState<{ pk?: string; nick?: string } | null>(null)
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const stored = localStorage.getItem('sidebarWidth')
    return stored ? Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, parseInt(stored))) : SIDEBAR_DEFAULT
  })
  const [isDragging, setIsDragging] = useState(false)
  const widthRef = useRef(sidebarWidth)

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = widthRef.current
    setIsDragging(true)

    const onMove = (me: MouseEvent) => {
      const newW = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startW + me.clientX - startX))
      widthRef.current = newW
      setSidebarWidth(newW)
    }
    const onUp = () => {
      setIsDragging(false)
      localStorage.setItem('sidebarWidth', String(widthRef.current))
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const handleDividerDblClick = useCallback(() => {
    widthRef.current = SIDEBAR_DEFAULT
    setSidebarWidth(SIDEBAR_DEFAULT)
    localStorage.setItem('sidebarWidth', String(SIDEBAR_DEFAULT))
  }, [])

  const openAddContact = (prefill?: { pk?: string; nick?: string }) => {
    setAddContactPrefill(prefill ?? {})
  }

  return (
    <div style={{ ...s.root, cursor: isDragging ? 'col-resize' : 'default' }}>
      <div style={{ width: sidebarWidth, flexShrink: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Sidebar
          onAddContact={openAddContact}
          onAddChannel={() => setShowCreateChannel(true)}
          onCreateGroup={() => setShowCreateGroup(true)}
        />
      </div>

      {/* Drag handle */}
      <div
        style={{
          width: 4, flexShrink: 0, cursor: 'col-resize', position: 'relative', zIndex: 10,
          background: isDragging ? 'var(--accent)' : 'transparent',
          transition: 'background 0.15s',
        }}
        onMouseDown={handleDividerMouseDown}
        onDoubleClick={handleDividerDblClick}
        title="Перетащите для изменения ширины · Двойной клик — сброс"
      >
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
          borderLeft: '1px solid var(--border)',
        }} />
      </div>

      <div style={s.chat}>
        {activeChannel
          ? <ChannelWindow />
          : activeChat
            ? <ChatWindow />
            : <EmptyState onAddContact={() => openAddContact()} />
        }
      </div>
      {addContactPrefill !== null && (
        <AddContactModal
          prefillPk={addContactPrefill.pk ?? ''}
          prefillNick={addContactPrefill.nick ?? ''}
          onClose={() => setAddContactPrefill(null)}
        />
      )}
      {showCreateChannel && (
        <CreateChannelModal onClose={() => setShowCreateChannel(false)} />
      )}
      {showCreateGroup && (
        <CreateGroupModal onClose={() => setShowCreateGroup(false)} />
      )}
    </div>
  )
}

function EmptyState({ onAddContact }: { onAddContact: () => void }) {
  return (
    <div style={s.empty}>
      <BearLogo size={80} style={{ marginBottom: 16 }} />
      <div style={s.emptyTitle}>Soviet</div>
      <div style={s.emptyText}>
        Децентрализованный мессенджер<br />
        без серверов и регистрации
      </div>
      <div style={s.features}>
        <FeatureItem icon="🔒" text="E2E шифрование" />
        <FeatureItem icon="📡" text="LAN без интернета" />
        <FeatureItem icon="⚡" text="Nostr-каналы" />
        <FeatureItem icon="🔑" text="Ваши ключи — ваши данные" />
      </div>
      <button className="btn-primary" style={s.addBtn} onClick={onAddContact}>
        + Добавить контакт
      </button>
    </div>
  )
}

function FeatureItem({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={s.feature}>
      <span>{icon}</span>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{text}</span>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', width: '100vw', height: '100vh',
    background: 'var(--bg-primary)', overflow: 'hidden',
  },
  chat: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  empty: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    color: 'var(--text-muted)', padding: 40,
  },
  emptyTitle: {
    fontSize: 22, fontWeight: 700,
    color: 'var(--text-secondary)', marginBottom: 8,
  },
  emptyText: {
    fontSize: 14, color: 'var(--text-muted)',
    textAlign: 'center', lineHeight: 1.6, marginBottom: 24,
  },
  features: {
    display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 28,
  },
  feature: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'var(--bg-secondary)', borderRadius: 8,
    padding: '7px 14px', border: '1px solid var(--border)',
  },
  addBtn: { padding: '10px 32px', fontSize: 14 },
}
