import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Contact, useStore } from '../store'

interface MenuItem {
  label: string
  icon: string
  danger?: boolean
  onClick: () => void
}

interface Props {
  contact: Contact
  x: number
  y: number
  onClose: () => void
  onOpenChat: () => void
  onViewProfile: () => void
  onToggleFavorite: () => void
  onDelete: () => void
}

export default function ContactContextMenu({
  contact, x, y, onClose,
  onOpenChat, onViewProfile, onToggleFavorite, onDelete,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const { contacts, loadContacts } = useStore()
  const [showFolderPanel, setShowFolderPanel] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Корректируем позицию чтобы не вылетело за экран
  const adjustedX = Math.min(x, window.innerWidth - 220)
  const adjustedY = Math.min(y, window.innerHeight - 280)

  // Collect distinct folder names from all contacts
  const existingFolders = Array.from(
    new Set(contacts.map(c => c.local_folder).filter((f): f is string => !!f))
  ).sort()

  const handleSetFolder = async (folder: string | null) => {
    await invoke('set_contact_folder', { publicKey: contact.public_key, folder })
    await loadContacts()
    onClose()
  }

  const handleNewFolder = async () => {
    const name = newFolderName.trim()
    if (!name) return
    await handleSetFolder(name)
  }

  const items: MenuItem[] = [
    { label: 'Написать', icon: '💬', onClick: onOpenChat },
    { label: 'Профиль', icon: '👤', onClick: onViewProfile },
    { label: contact.is_favorite ? 'Убрать из избранного' : 'В избранное', icon: '★', onClick: onToggleFavorite },
  ]

  return (
    <div
      ref={ref}
      style={{ ...s.menu, left: adjustedX, top: adjustedY }}
      className="fade-in"
    >
      {items.map((item, i) => (
        <div key={i}>
          <div
            style={{ ...s.item, color: 'var(--text-primary)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            onClick={() => { item.onClick(); onClose() }}
          >
            <span style={{ fontSize: 14 }}>{item.icon}</span>
            <span>{item.label}</span>
          </div>
        </div>
      ))}

      {/* Folder item */}
      <div>
        <div
          style={{ ...s.item, color: 'var(--text-primary)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = showFolderPanel ? 'var(--bg-hover)' : 'transparent')}
          onClick={() => setShowFolderPanel(v => !v)}
        >
          <span style={{ fontSize: 14 }}>📁</span>
          <span style={{ flex: 1 }}>Переместить в папку...</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{showFolderPanel ? '▾' : '▸'}</span>
        </div>

        {showFolderPanel && (
          <div style={s.folderPanel}>
            {contact.local_folder && (
              <div
                style={s.folderChip}
                onClick={() => handleSetFolder(null)}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>✕</span>
                <span style={{ fontSize: 12 }}>Без папки</span>
              </div>
            )}
            {existingFolders.map(f => (
              <div
                key={f}
                style={{
                  ...s.folderChip,
                  background: contact.local_folder === f ? 'rgba(0,255,65,0.10)' : 'transparent',
                }}
                onClick={() => handleSetFolder(f)}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = contact.local_folder === f ? 'rgba(0,255,65,0.10)' : 'transparent')}
              >
                <span style={{ fontSize: 12 }}>📁</span>
                <span style={{ fontSize: 12 }}>{f}</span>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 4, padding: '4px 6px 2px' }}>
              <input
                style={s.folderInput}
                placeholder="Новая папка..."
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleNewFolder() }}
                autoFocus
              />
              <button
                style={s.folderBtn}
                onClick={handleNewFolder}
              >
                OK
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={s.sep} />
      <div
        style={{ ...s.item, color: 'var(--busy)' }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        onClick={() => { onDelete(); onClose() }}
      >
        <span style={{ fontSize: 14 }}>🗑️</span>
        <span>Удалить контакт</span>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  menu: {
    position: 'fixed',
    zIndex: 500,
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    boxShadow: '0 6px 24px var(--shadow)',
    padding: '4px',
    minWidth: 210,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '7px 10px',
    borderRadius: 7,
    cursor: 'pointer',
    fontSize: 13,
    transition: 'background 0.1s',
  },
  sep: {
    height: 1,
    background: 'var(--border)',
    margin: '4px 0',
  },
  folderPanel: {
    borderTop: '1px solid var(--border)',
    borderBottom: '1px solid var(--border)',
    padding: '4px 0',
    margin: '0',
    background: 'var(--bg-secondary)',
  },
  folderChip: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 14px',
    cursor: 'pointer',
    transition: 'background 0.1s',
    borderRadius: 0,
  },
  folderInput: {
    flex: 1,
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '4px 7px',
    fontSize: 12,
    color: 'var(--text-primary)',
    outline: 'none',
  },
  folderBtn: {
    background: 'var(--accent)',
    border: 'none',
    borderRadius: 6,
    padding: '4px 8px',
    fontSize: 12,
    color: 'var(--accent-text)',
    cursor: 'pointer',
    flexShrink: 0,
  },
}
