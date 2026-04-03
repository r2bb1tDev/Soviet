import { useState } from 'react'
import { useStore, Contact } from '../store'

interface Props {
  onClose: () => void
}

export default function CreateGroupModal({ onClose }: Props) {
  const { contacts, createGroup } = useStore()
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const toggle = (pk: string) => {
    setSelected(s => {
      const n = new Set(s)
      if (n.has(pk)) n.delete(pk); else n.add(pk)
      return n
    })
  }

  const handleCreate = async () => {
    if (!name.trim()) { setError('Введите название группы'); return }
    if (selected.size === 0) { setError('Выберите хотя бы одного участника'); return }
    setLoading(true); setError('')
    try {
      await createGroup(name.trim(), Array.from(selected))
      setDone(true)
      setTimeout(onClose, 1200)
    } catch (e) {
      setError('Ошибка: ' + String(e))
    } finally {
      setLoading(false)
    }
  }

  const onlineContacts = contacts.filter(c => !c.is_blocked)

  return (
    <div style={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={s.modal} className="fade-in">
        <div style={s.title}>👥 Создать группу</div>

        {done ? (
          <div style={s.success}>✅ Группа создана!</div>
        ) : (
          <>
            <label style={s.label}>Название группы</label>
            <input
              style={s.input}
              placeholder="Например: Рабочая группа"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />

            <label style={{ ...s.label, marginTop: 14 }}>
              Участники ({selected.size} выбрано)
            </label>
            <div style={s.memberList}>
              {onlineContacts.length === 0 && (
                <div style={s.empty}>Нет контактов для добавления</div>
              )}
              {onlineContacts.map(c => (
                <MemberRow
                  key={c.public_key}
                  contact={c}
                  selected={selected.has(c.public_key)}
                  onToggle={() => toggle(c.public_key)}
                />
              ))}
            </div>

            {error && <div style={s.error}>{error}</div>}

            <div style={s.buttons}>
              <button className="btn-secondary" style={s.btn} onClick={onClose}>Отмена</button>
              <button className="btn-primary" style={s.btn} onClick={handleCreate} disabled={loading}>
                {loading ? 'Создание...' : 'Создать'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function MemberRow({ contact, selected, onToggle }: {
  contact: Contact; selected: boolean; onToggle: () => void
}) {
  const name = contact.local_alias ?? contact.nickname
  return (
    <div style={{ ...mr.row, background: selected ? 'rgba(var(--accent-rgb,51,102,204),0.12)' : 'transparent' }}
      onClick={onToggle}>
      <div style={mr.avatar}>{name.charAt(0).toUpperCase()}</div>
      <div style={mr.info}>
        <div style={mr.name}>{name}</div>
        <div style={mr.sub}>
          <span className={`status-dot ${contact.status}`} style={{ marginRight: 4 }} />
          {{ online: 'Онлайн', away: 'Отошёл', busy: 'Занят', offline: 'Не в сети' }[contact.status]}
        </div>
      </div>
      <div style={{ ...mr.check, background: selected ? 'var(--accent)' : 'transparent',
        border: selected ? 'none' : '2px solid var(--border)' }}>
        {selected && <span style={{ color: 'white', fontSize: 12 }}>✓</span>}
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
    width: 400, maxHeight: '80vh', overflowY: 'auto',
    boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
  },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 16 },
  label: { display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 },
  input: { width: '100%' },
  memberList: {
    maxHeight: 240, overflowY: 'auto',
    border: '1px solid var(--border)', borderRadius: 10,
  },
  empty: { padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 },
  error: {
    marginTop: 8, padding: '7px 10px', borderRadius: 7,
    background: 'rgba(244,67,54,0.1)', color: 'var(--busy)', fontSize: 13,
  },
  buttons: { display: 'flex', gap: 8, marginTop: 18 },
  btn: { flex: 1 },
  success: { textAlign: 'center', padding: '24px 0', fontSize: 16, color: 'var(--online)' },
}

const mr: Record<string, React.CSSProperties> = {
  row: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '9px 12px', cursor: 'pointer',
    borderBottom: '1px solid var(--border)', transition: 'background 0.1s',
  },
  avatar: {
    width: 32, height: 32, borderRadius: '50%',
    background: 'var(--accent)', color: 'white',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 700, fontSize: 14, flexShrink: 0,
  },
  info: { flex: 1 },
  name: { fontSize: 13, fontWeight: 500 },
  sub: { fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', marginTop: 2 },
  check: {
    width: 20, height: 20, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
}
