import { useState } from 'react'
import { useStore } from '../store'

interface Props {
  onClose: () => void
  onCreated?: (channelId: string) => void
}

export default function CreateChannelModal({ onClose, onCreated }: Props) {
  const { createChannel, joinChannel } = useStore()
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [name, setName] = useState('')
  const [about, setAbout] = useState('')
  const [joinId, setJoinId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const handleCreate = async () => {
    if (!name.trim()) { setError('Введите название канала'); return }
    setLoading(true); setError('')
    try {
      const id = await createChannel(name.trim(), about.trim())
      setDone(true)
      setTimeout(() => { onCreated?.(id); onClose() }, 1000)
    } catch (e) {
      setError('Ошибка: ' + String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleJoin = async () => {
    const id = joinId.trim()
    if (id.length < 40) { setError('Введите корректный ID канала (64 hex символа)'); return }
    setLoading(true); setError('')
    try {
      const relay = localStorage.getItem('customRelay') || undefined
      await joinChannel(id, relay)
      setDone(true)
      setTimeout(() => { onCreated?.(id); onClose() }, 1000)
    } catch (e) {
      setError('Ошибка: ' + String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={s.modal} className="fade-in">
        <div style={s.title}>📡 Каналы Nostr</div>

        <div style={s.tabs}>
          <button className={mode === 'create' ? 'btn-primary' : 'btn-secondary'}
            style={s.tab} onClick={() => setMode('create')}>
            Создать
          </button>
          <button className={mode === 'join' ? 'btn-primary' : 'btn-secondary'}
            style={s.tab} onClick={() => setMode('join')}>
            Войти по ID
          </button>
        </div>

        {done ? (
          <div style={s.success}>{mode === 'create' ? '✅ Канал создан!' : '✅ Вступили в канал!'}</div>
        ) : mode === 'create' ? (
          <>
            <div style={s.hint}>
              Ваш канал появится в децентрализованной сети Nostr.<br/>
              Поделитесь ID с теми, кого хотите пригласить.
            </div>
            <label style={s.label}>Название</label>
            <input style={s.input} value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Например: Обсуждение проекта"
              autoFocus />
            <label style={{ ...s.label, marginTop: 12 }}>Описание (необязательно)</label>
            <input style={s.input} value={about}
              onChange={e => setAbout(e.target.value)}
              placeholder="О чём этот канал?" />
            {error && <div style={s.error}>{error}</div>}
            <div style={s.buttons}>
              <button className="btn-secondary" style={s.btn} onClick={onClose}>Отмена</button>
              <button className="btn-primary" style={s.btn} onClick={handleCreate} disabled={loading}>
                {loading ? 'Создание...' : 'Создать'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={s.hint}>
              Введите 64-символьный ID канала Nostr, чтобы вступить и читать сообщения.
            </div>
            <label style={s.label}>ID канала</label>
            <textarea style={{ ...s.input, height: 80, resize: 'none', fontFamily: 'monospace', fontSize: 12 } as React.CSSProperties}
              value={joinId}
              onChange={e => setJoinId(e.target.value)}
              placeholder="64 hex символа..." autoFocus />
            {error && <div style={s.error}>{error}</div>}
            <div style={s.buttons}>
              <button className="btn-secondary" style={s.btn} onClick={onClose}>Отмена</button>
              <button className="btn-primary" style={s.btn} onClick={handleJoin} disabled={loading}>
                {loading ? 'Подключение...' : 'Вступить'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 200,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    background: 'var(--bg-primary)', border: '1px solid var(--border)',
    borderRadius: 16, padding: '24px 28px',
    width: 420, boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
  },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 16, color: 'var(--text-primary)' },
  tabs: { display: 'flex', gap: 8, marginBottom: 16 },
  tab: { flex: 1 },
  hint: {
    fontSize: 12, color: 'var(--text-secondary)',
    background: 'var(--bg-secondary)', borderRadius: 8,
    padding: '10px 12px', marginBottom: 14, lineHeight: 1.6,
    border: '1px solid var(--border)',
  },
  label: { display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 5 },
  input: { width: '100%' },
  error: {
    marginTop: 8, padding: '7px 10px', borderRadius: 7,
    background: 'rgba(244,67,54,0.1)', color: 'var(--busy)', fontSize: 13,
  },
  buttons: { display: 'flex', gap: 8, marginTop: 18 },
  btn: { flex: 1 },
  success: {
    textAlign: 'center', padding: '24px 0',
    fontSize: 16, color: 'var(--online)',
  },
}
