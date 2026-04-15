import { useEffect, useRef } from 'react'
import { Contact } from '../store'

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
  onOpenInWindow: () => void
  onViewProfile: () => void
  onToggleFavorite: () => void
  onDelete: () => void
}

export default function ContactContextMenu({
  contact, x, y, onClose,
  onOpenChat, onOpenInWindow, onViewProfile, onToggleFavorite, onDelete,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

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
  const adjustedX = Math.min(x, window.innerWidth - 180)
  const adjustedY = Math.min(y, window.innerHeight - 200)

  const items: MenuItem[] = [
    { label: 'Написать', icon: '💬', onClick: onOpenChat },
    { label: 'Открыть в новом окне', icon: '🪟', onClick: onOpenInWindow },
    { label: 'Профиль', icon: '👤', onClick: onViewProfile },
    { label: contact.is_favorite ? 'Убрать из избранного' : 'В избранное', icon: '★', onClick: onToggleFavorite },
    { label: 'Удалить контакт', icon: '🗑️', danger: true, onClick: onDelete },
  ]

  return (
    <div
      ref={ref}
      style={{ ...s.menu, left: adjustedX, top: adjustedY }}
      className="fade-in"
    >
      {items.map((item, i) => (
        <div key={i}>
          {i === items.length - 1 && <div style={s.sep} />}
          <div
            style={{
              ...s.item,
              color: item.danger ? 'var(--busy)' : 'var(--text-primary)',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            onClick={() => { item.onClick(); onClose() }}
          >
            <span style={{ fontSize: 14 }}>{item.icon}</span>
            <span>{item.label}</span>
          </div>
        </div>
      ))}
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
    minWidth: 168,
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
}
