import { useEffect } from 'react'
import { useStore, type ToastItem } from '../store'

export default function ToastContainer() {
  const { toasts, removeToast, setActiveChat, chats, setPage } = useStore()

  const handleClick = (toast: ToastItem) => {
    if (toast.chatId) {
      const chat = chats.find(c => c.id === toast.chatId)
      if (chat) {
        setActiveChat(chat)
        setPage('main')
      }
    }
    removeToast(toast.id)
  }

  if (toasts.length === 0) return null

  return (
    <div style={s.container}>
      {toasts.map(toast => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onClick={() => handleClick(toast)}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </div>
  )
}

function ToastItem({ toast, onClick, onClose }: {
  toast: ToastItem
  onClick: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000)
    return () => clearTimeout(timer)
  }, [])

  const icon = {
    message: '💬',
    request: '👤',
    error: '⚠️',
    success: '✓',
  }[toast.type]

  return (
    <div
      style={s.toast}
      onClick={onClick}
      className="fade-in"
    >
      <div style={s.toastIcon}>{icon}</div>
      <div style={s.toastContent}>
        <div style={s.toastTitle}>{toast.title}</div>
        {toast.body && <div style={s.toastBody}>{toast.body}</div>}
      </div>
      <button
        style={s.closeBtn}
        onClick={e => { e.stopPropagation(); onClose() }}
      >
        ×
      </button>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    top: 12,
    right: 12,
    zIndex: 9999,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    pointerEvents: 'none',
  },
  toast: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '10px 14px',
    minWidth: 240,
    maxWidth: 340,
    boxShadow: '0 4px 20px var(--shadow)',
    cursor: 'pointer',
    pointerEvents: 'all',
    transition: 'opacity 0.2s',
  },
  toastIcon: {
    fontSize: 18,
    flexShrink: 0,
    marginTop: 1,
  },
  toastContent: { flex: 1, minWidth: 0 },
  toastTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  toastBody: {
    fontSize: 12,
    color: 'var(--text-secondary)',
    marginTop: 2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
  },
  closeBtn: {
    background: 'transparent',
    color: 'var(--text-muted)',
    fontSize: 18,
    lineHeight: 1,
    padding: '0 2px',
    flexShrink: 0,
    borderRadius: 4,
  },
}
