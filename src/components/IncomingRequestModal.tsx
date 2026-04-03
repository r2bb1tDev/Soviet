import { invoke } from '@tauri-apps/api/core'
import { useStore } from '../store'

interface ContactRequest {
  id: number
  public_key: string
  nickname: string
  direction: string
  status: string
  created_at: number
}

interface Props {
  request: ContactRequest
  onClose: () => void
}

export default function IncomingRequestModal({ request, onClose }: Props) {
  const { loadContacts, loadChats } = useStore()

  const accept = async () => {
    await invoke('accept_contact_request', {
      publicKey: request.public_key,
      nickname: request.nickname,
    })
    await loadContacts()
    await loadChats()
    onClose()
  }

  const reject = async () => {
    await invoke('reject_contact_request', { publicKey: request.public_key })
    onClose()
  }

  const copyKey = () => {
    navigator.clipboard.writeText(request.public_key)
  }

  return (
    <div style={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={s.modal} className="fade-in">
        {/* Иконка */}
        <div style={s.iconWrap}>
          <div style={s.icon}>👤</div>
        </div>

        <h2 style={s.title}>Запрос на добавление</h2>
        <p style={s.subtitle}>
          <strong>{request.nickname}</strong> хочет добавить вас в контакты
        </p>

        <div style={s.keyBox}>
          <span style={s.keyText}>{request.public_key}</span>
          <button className="btn-icon" onClick={copyKey} title="Копировать ключ" style={{ fontSize: 14 }}>
            📋
          </button>
        </div>

        <div style={s.buttons}>
          <button className="btn-secondary" style={s.btn} onClick={reject}>
            Отклонить
          </button>
          <button className="btn-primary" style={s.btn} onClick={accept}>
            Принять
          </button>
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 400,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: 16, padding: '28px 28px 24px',
    width: 360, textAlign: 'center',
    boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
  },
  iconWrap: {
    display: 'flex', justifyContent: 'center', marginBottom: 16,
  },
  icon: {
    width: 56, height: 56, borderRadius: '50%',
    background: 'var(--accent)', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    fontSize: 28,
  },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 8 },
  subtitle: {
    fontSize: 14, color: 'var(--text-secondary)',
    marginBottom: 16, lineHeight: 1.5,
  },
  keyBox: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 8, padding: '8px 10px',
    marginBottom: 20, textAlign: 'left',
  },
  keyText: {
    fontFamily: 'monospace', fontSize: 11,
    color: 'var(--text-muted)', flex: 1,
    wordBreak: 'break-all',
  },
  buttons: { display: 'flex', gap: 8 },
  btn: { flex: 1 },
}
