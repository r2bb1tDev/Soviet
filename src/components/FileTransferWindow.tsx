import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

type OutboxItem = {
  id: number
  kind: string
  target: string
  msg_id: number
  content_type: string
  status: string
  attempts: number
  next_retry_at: number
  last_error?: string | null
  updated_at: number
}

export default function FileTransferWindow({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<OutboxItem[]>([])
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const queued = await invoke<OutboxItem[]>('get_outbox', { status: 'queued', limit: 200 })
      setItems(queued.filter(i => i.kind === 'file' || i.content_type === 'file' || i.content_type === 'image'))
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const cancel = async (msgId: number) => {
    try {
      await invoke('cancel_outbox', { msgId })
      await load()
    } catch {}
  }

  return (
    <div style={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={s.modal} className="fade-in" onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <span style={{ fontWeight: 700 }}>Окно передачи файлов</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        <div style={s.hint}>
          Файлы отправляются напрямую (LAN/P2P) или через очередь офлайн‑доставки.
        </div>

        {loading && <div style={s.empty}>Загрузка…</div>}

        {!loading && items.length === 0 && (
          <div style={s.empty}>Нет активных передач.</div>
        )}

        {!loading && items.length > 0 && (
          <div style={s.list}>
            {items.map(it => (
              <div key={it.id} style={s.row}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }} className="truncate">
                    {it.content_type === 'image' ? '🖼️ Изображение' : '📎 Файл'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }} className="truncate">
                    Кому: {it.target.slice(0, 16)}… · попыток: {it.attempts}
                  </div>
                </div>
                <button className="btn-secondary" style={s.btn} onClick={() => cancel(it.msg_id)}>
                  Cancel
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 8000,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    width: 520,
    maxWidth: '90vw',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '80vh',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border)',
  },
  hint: {
    padding: '10px 16px',
    fontSize: 12,
    color: 'var(--text-muted)',
    borderBottom: '1px solid var(--border)',
  },
  list: { padding: 12, overflowY: 'auto' },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    border: '1px solid var(--border)',
    borderRadius: 12,
    background: 'var(--bg-secondary)',
    marginBottom: 8,
  },
  btn: { fontSize: 12, padding: '6px 10px' },
  empty: { padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 },
}

