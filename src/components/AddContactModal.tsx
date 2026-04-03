import { useState } from 'react'
import { useStore } from '../store'

interface Props {
  onClose: () => void
  prefillPk?: string
  prefillNick?: string
}

/** Пытается распарсить приглашение из любого формата и вернуть { pk, nick } */
function parseInvite(text: string): { pk: string; nick: string } | null {
  const t = text.trim()

  // Формат: Soviet | Nickname | PublicKey  (опционально: | @customId)
  const sovietInvite = t.match(/^Soviet\s*\|\s*(.+?)\s*\|\s*([A-Za-z0-9]{20,})(\s*\|.*)?$/i)
  if (sovietInvite) return { nick: sovietInvite[1].trim(), pk: sovietInvite[2].trim() }

  // Формат: soviet://add?pk=...&nick=...
  if (t.startsWith('soviet://')) {
    try {
      const url = new URL(t.replace('soviet://', 'https://soviet'))
      const pk = url.searchParams.get('pk') ?? ''
      const nick = url.searchParams.get('nick') ?? ''
      if (pk.length > 20) return { pk, nick }
    } catch { /* ignore */ }
  }

  // Старый формат: sovietim://add/PublicKey
  if (t.startsWith('sovietim://add/')) {
    const pk = t.replace('sovietim://add/', '')
    if (pk.length > 20) return { pk, nick: '' }
  }

  // Чистый ключ (base58, 40+ символов)
  if (/^[A-Za-z0-9]{40,}$/.test(t)) return { pk: t, nick: '' }

  return null
}

export default function AddContactModal({ onClose, prefillPk = '', prefillNick = '' }: Props) {
  const { addContact, identity } = useStore()
  const [input, setInput] = useState(prefillPk || prefillNick
    ? (prefillNick && prefillPk ? `Soviet | ${prefillNick} | ${prefillPk}` : prefillPk)
    : '')
  const [nick, setNick] = useState(prefillNick)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [parsedPk, setParsedPk] = useState(prefillPk)
  const [parsedNick, setParsedNick] = useState(prefillNick)

  const handleInputChange = (value: string) => {
    setInput(value)
    setError('')
    const parsed = parseInvite(value)
    if (parsed) {
      setParsedPk(parsed.pk)
      if (parsed.nick) {
        setParsedNick(parsed.nick)
        setNick(parsed.nick)
      }
    } else {
      setParsedPk('')
    }
  }

  const effectivePk = parsedPk || input.trim()
  const effectiveNick = nick.trim()

  const handleAdd = async () => {
    if (!effectivePk) { setError('Вставьте приглашение или публичный ключ'); return }
    if (!effectiveNick) { setError('Введите никнейм'); return }
    if (effectivePk === identity?.public_key) { setError('Это ваш собственный ключ'); return }
    if (effectivePk.length < 20) { setError('Слишком короткий ключ — скопируйте полный'); return }

    setLoading(true); setError('')
    try {
      await addContact(effectivePk, effectiveNick)
      setDone(true)
      setTimeout(onClose, 1000)
    } catch (e) {
      setError('Ошибка: ' + String(e))
    } finally {
      setLoading(false)
    }
  }

  const isParsed = !!parsedPk && parsedPk.length > 20

  return (
    <div style={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={s.modal} className="fade-in">
        <div style={s.title}>Добавить контакт</div>

        {done ? (
          <div style={s.success}>✅ Контакт добавлен!</div>
        ) : (
          <>
            {/* Инструкция */}
            <div style={s.howto}>
              <b>Как получить ключ друга?</b><br/>
              Попроси его открыть <b>Настройки → Мой QR-код</b> и нажать<br/>
              <b>«Копировать приглашение»</b> — затем вставь сюда
            </div>

            <label style={s.label}>
              Приглашение / ключ
              {isParsed && <span style={s.parsedBadge}>✓ распознано</span>}
            </label>
            <textarea
              style={{ ...s.input, height: 90, resize: 'none',
                borderColor: isParsed ? 'var(--online)' : undefined }}
              placeholder={'Вставь приглашение:\nSoviet | Nickname | PublicKey\n\nили просто публичный ключ'}
              value={input}
              onChange={e => handleInputChange(e.target.value)}
              autoFocus
            />

            {/* Показываем что распарсили */}
            {isParsed && (
              <div style={s.parsedInfo}>
                <span>🔑 Ключ: <code>{parsedPk.slice(0, 12)}…</code></span>
                {parsedNick && <span style={{ marginLeft: 12 }}>👤 Ник: <b>{parsedNick}</b></span>}
              </div>
            )}

            <label style={{ ...s.label, marginTop: 12 }}>Имя для отображения</label>
            <input
              style={s.input}
              placeholder="Как назвать этот контакт у тебя"
              value={nick}
              onChange={e => setNick(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />

            {error && <div style={s.error}>{error}</div>}

            <div style={s.buttons}>
              <button className="btn-secondary" style={s.btn} onClick={onClose}>
                Отмена
              </button>
              <button className="btn-primary" style={s.btn} onClick={handleAdd} disabled={loading}>
                {loading ? 'Добавление...' : 'Добавить'}
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
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: 16, padding: '24px 28px',
    width: 400, boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
  },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 14, color: 'var(--text-primary)' },
  howto: {
    fontSize: 12, color: 'var(--text-secondary)',
    background: 'var(--bg-secondary)', borderRadius: 8,
    padding: '10px 12px', marginBottom: 14, lineHeight: 1.6,
    border: '1px solid var(--border)',
  },
  label: {
    display: 'flex', alignItems: 'center', gap: 8,
    fontSize: 12, color: 'var(--text-secondary)', marginBottom: 5,
  },
  parsedBadge: {
    fontSize: 11, color: 'var(--online)', fontWeight: 600,
    background: 'rgba(76,175,80,0.12)', padding: '1px 6px', borderRadius: 4,
  },
  input: { width: '100%' },
  parsedInfo: {
    marginTop: 6, padding: '6px 10px', borderRadius: 6,
    background: 'rgba(76,175,80,0.08)', border: '1px solid var(--online)',
    fontSize: 12, color: 'var(--text-primary)',
  },
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
