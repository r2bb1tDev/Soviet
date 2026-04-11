import { useEffect, useRef } from 'react'
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

const TOAST_DURATION = 5000

function ToastItem({ toast, onClick, onClose }: {
  toast: ToastItem
  onClick: () => void
  onClose: () => void
}) {
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = setTimeout(onClose, TOAST_DURATION)
    // Animate progress bar
    if (barRef.current) {
      barRef.current.style.transition = 'none'
      barRef.current.style.width = '100%'
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (barRef.current) {
            barRef.current.style.transition = `width ${TOAST_DURATION}ms linear`
            barRef.current.style.width = '0%'
          }
        })
      })
    }
    return () => clearTimeout(timer)
  }, [])

  const icon = {
    message: '💬',
    request: '👤',
    error: '⚠️',
    success: '✓',
  }[toast.type]

  const accentColor = toast.type === 'error' ? 'var(--busy)' : 'var(--accent)'

  return (
    <div
      style={{ ...s.toast, borderLeft: `3px solid ${accentColor}` }}
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
      <div style={s.progressTrack}>
        <div ref={barRef} style={{ ...s.progressBar, background: accentColor }} />
      </div>
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
    position: 'relative',
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
  progressTrack: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: 2,
    background: 'var(--border)',
    borderRadius: '0 0 12px 12px',
  },
  progressBar: {
    height: '100%',
    width: '100%',
    borderRadius: '0 0 12px 0',
  },
}
