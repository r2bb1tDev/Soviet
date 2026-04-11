import { useEffect } from 'react'

interface Props {
  onClose: () => void
}

const SHORTCUTS = [
  { keys: ['Ctrl', 'F'], desc: 'Фокус поиска' },
  { keys: ['Ctrl', 'N'], desc: 'Новый чат / контакт' },
  { keys: ['Ctrl', '?'], desc: 'Эта справка' },
  { keys: ['Esc'], desc: 'Закрыть меню / режим редактирования' },
  { keys: ['Enter'], desc: 'Отправить сообщение' },
  { keys: ['Shift', 'Enter'], desc: 'Новая строка в сообщении' },
  { keys: ['Ctrl', 'Enter'], desc: 'Отправить (альтернатива)' },
  { keys: ['↑'], desc: 'Редактировать последнее своё сообщение' },
]

export default function KeyboardShortcuts({ onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div style={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={s.modal} className="fade-in">
        <div style={s.header}>
          <span style={s.title}>⌨️ Горячие клавиши</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div style={s.list}>
          {SHORTCUTS.map((sc, i) => (
            <div key={i} style={s.row}>
              <div style={s.keys}>
                {sc.keys.map((k, j) => (
                  <span key={j}>
                    <kbd style={s.kbd}>{k}</kbd>
                    {j < sc.keys.length - 1 && <span style={s.plus}>+</span>}
                  </span>
                ))}
              </div>
              <span style={s.desc}>{sc.desc}</span>
            </div>
          ))}
        </div>
        <div style={s.footer}>
          Нажмите <kbd style={{ ...s.kbd, fontSize: 11 }}>Esc</kbd> или кликните снаружи для закрытия
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 9000,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    width: 380,
    boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 16px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg-secondary)',
  },
  title: { fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' },
  list: { padding: '8px 0' },
  row: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 16px', gap: 12,
  },
  keys: { display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 },
  kbd: {
    display: 'inline-block',
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border)',
    borderRadius: 5,
    padding: '2px 7px',
    fontSize: 12,
    fontFamily: 'monospace',
    color: 'var(--text-primary)',
    boxShadow: '0 1px 0 var(--border)',
  },
  plus: { fontSize: 11, color: 'var(--text-muted)', margin: '0 1px' },
  desc: { fontSize: 13, color: 'var(--text-secondary)', textAlign: 'right' as const },
  footer: {
    padding: '10px 16px',
    borderTop: '1px solid var(--border)',
    background: 'var(--bg-secondary)',
    fontSize: 11,
    color: 'var(--text-muted)',
    textAlign: 'center' as const,
  },
}
