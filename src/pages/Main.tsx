import { useState } from 'react'
import { useStore } from '../store'
import Sidebar from '../components/Sidebar'
import ChatWindow from '../components/ChatWindow'
import ChannelWindow from '../components/ChannelWindow'
import AddContactModal from '../components/AddContactModal'
import CreateChannelModal from '../components/CreateChannelModal'
import CreateGroupModal from '../components/CreateGroupModal'
import BearLogo from '../components/BearLogo'

export default function Main() {
  const { activeChat, activeChannel } = useStore()
  const [addContactPrefill, setAddContactPrefill] = useState<{ pk?: string; nick?: string } | null>(null)
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [showCreateGroup, setShowCreateGroup] = useState(false)

  const openAddContact = (prefill?: { pk?: string; nick?: string }) => {
    setAddContactPrefill(prefill ?? {})
  }

  return (
    <div style={s.root}>
      <Sidebar
        onAddContact={openAddContact}
        onAddChannel={() => setShowCreateChannel(true)}
        onCreateGroup={() => setShowCreateGroup(true)}
      />
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
