import { useStore, Chat } from '../store'

function stringToColor(str: string): string {
  const palette = [
    '#FF6B6B', '#FF8E53', '#FFD93D', '#6BCB77',
    '#2AABEE', '#845EC2', '#FF9671', '#F9F871',
    '#00C9A7', '#C34B4B', '#4D8B31', '#3D5A80',
  ]
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return palette[Math.abs(hash) % palette.length]
}

export default function ChatTabs() {
  const { openTabs, activeTabId, switchTab, closeTab, contacts, chats } = useStore()

  if (openTabs.length <= 1) return null

  const getDisplayName = (tab: Chat): string => {
    if (tab.chat_type === 'group') return tab.group_name ?? 'Группа'
    if (tab.peer_key) {
      const contact = contacts.find(c => c.public_key === tab.peer_key)
      return contact?.local_alias ?? contact?.nickname ?? tab.peer_key.slice(0, 10) + '…'
    }
    return 'Чат'
  }

  const getUnread = (tab: Chat): number => {
    const chat = chats.find(c => c.id === tab.id)
    return chat?.unread_count ?? tab.unread_count ?? 0
  }

  const getAvatarLetter = (tab: Chat): string => {
    if (tab.chat_type === 'group') return (tab.group_name ?? 'G').charAt(0).toUpperCase()
    const name = getDisplayName(tab)
    return name.charAt(0).toUpperCase()
  }

  const getAvatarColor = (tab: Chat): string => {
    if (tab.chat_type === 'group') return '#7B68EE'
    return tab.peer_key ? stringToColor(tab.peer_key) : '#888'
  }

  const getAvatar = (tab: Chat): string | null => {
    if (tab.peer_key) {
      const contact = contacts.find(c => c.public_key === tab.peer_key)
      return contact?.avatar_data ?? null
    }
    return null
  }

  return (
    <div style={s.tabBar}>
      {openTabs.map(tab => {
        const isActive = tab.id === activeTabId
        const name = getDisplayName(tab)
        const unread = getUnread(tab)
        const avatarSrc = getAvatar(tab)
        const letter = getAvatarLetter(tab)
        const color = getAvatarColor(tab)

        return (
          <div
            key={tab.id}
            style={{
              ...s.tab,
              borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              background: isActive ? 'var(--bg-tertiary)' : 'transparent',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
            onClick={() => switchTab(tab.id)}
            onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id) } }}
            title={name}
          >
            <div style={{ ...s.tabAvatar, background: avatarSrc ? 'transparent' : color }}>
              {avatarSrc
                ? <img src={avatarSrc} style={s.tabAvatarImg} alt="" />
                : letter
              }
            </div>
            <span style={s.tabName}>{name.length > 12 ? name.slice(0, 12) + '…' : name}</span>
            {unread > 0 && (
              <span className="unread-badge" style={s.tabBadge}>
                {unread > 99 ? '99+' : unread}
              </span>
            )}
            <button
              style={s.closeBtn}
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
              title="Закрыть"
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  tabBar: {
    display: 'flex',
    flexDirection: 'row',
    overflowX: 'auto',
    background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
    scrollbarWidth: 'none',
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '4px 8px 4px 8px',
    cursor: 'pointer',
    transition: 'background 0.1s, color 0.1s',
    flexShrink: 0,
    maxWidth: 180,
    minWidth: 90,
    userSelect: 'none',
    position: 'relative',
  },
  tabAvatar: {
    width: 20,
    height: 20,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 10,
    fontWeight: 700,
    color: '#fff',
    flexShrink: 0,
    overflow: 'hidden',
  },
  tabAvatarImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    borderRadius: '50%',
  },
  tabName: {
    fontSize: 12,
    fontWeight: 500,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  tabBadge: {
    fontSize: 9,
    minWidth: 14,
    height: 14,
    lineHeight: '14px',
    padding: '0 3px',
    flexShrink: 0,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--text-muted)',
    fontSize: 14,
    lineHeight: 1,
    padding: '0 2px',
    flexShrink: 0,
    borderRadius: 3,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 16,
    height: 16,
  },
}
