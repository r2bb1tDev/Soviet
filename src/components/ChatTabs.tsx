import { useRef, useState, useEffect, useCallback } from 'react'
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

interface ContextMenu {
  x: number
  y: number
  chatId: number
}

export default function ChatTabs() {
  const {
    openTabs, activeTabId, switchTab, closeTab, contacts, chats,
    reorderTabs, togglePinTab, pinnedTabIds,
  } = useStore()

  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const dragSrcIndex = useRef<number | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [contextMenu])


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
    return getDisplayName(tab).charAt(0).toUpperCase()
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

  // Drag handlers
  const onDragStart = useCallback((index: number) => {
    dragSrcIndex.current = index
  }, [])

  const onDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }, [])

  const onDrop = useCallback((toIndex: number) => {
    const fromIndex = dragSrcIndex.current
    if (fromIndex !== null && fromIndex !== toIndex) {
      reorderTabs(fromIndex, toIndex)
    }
    dragSrcIndex.current = null
    setDragOverIndex(null)
  }, [reorderTabs])

  const onDragEnd = useCallback(() => {
    dragSrcIndex.current = null
    setDragOverIndex(null)
  }, [])

  // Right-click menu actions
  const closeOthers = (chatId: number) => {
    openTabs.filter(t => t.id !== chatId).forEach(t => closeTab(t.id))
    setContextMenu(null)
  }

  const menuTab = contextMenu ? openTabs.find(t => t.id === contextMenu.chatId) : null

  return (
    <>
      <div style={s.tabBar}>
        {openTabs.map((tab, index) => {
          const isActive = tab.id === activeTabId
          const isPinned = pinnedTabIds.has(tab.id)
          const name = getDisplayName(tab)
          const unread = getUnread(tab)
          const avatarSrc = getAvatar(tab)
          const letter = getAvatarLetter(tab)
          const color = getAvatarColor(tab)
          const isDragTarget = dragOverIndex === index

          return (
            <div
              key={tab.id}
              draggable
              onDragStart={() => onDragStart(index)}
              onDragOver={(e) => onDragOver(e, index)}
              onDrop={() => onDrop(index)}
              onDragEnd={onDragEnd}
              style={{
                ...s.tab,
                borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                background: isActive
                  ? 'var(--bg-tertiary)'
                  : isDragTarget
                    ? 'var(--bg-hover, rgba(255,255,255,0.07))'
                    : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                outline: isDragTarget ? '1px dashed var(--accent)' : 'none',
              }}
              onClick={() => switchTab(tab.id)}
              onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id) } }}
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({ x: e.clientX, y: e.clientY, chatId: tab.id })
              }}
              title={name + (isPinned ? ' (закреплён)' : '')}
            >
              {isPinned && <span style={s.pinDot} title="Закреплён" />}
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

      {contextMenu && menuTab && (
        <div
          ref={menuRef}
          style={{
            ...s.ctxMenu,
            left: Math.min(contextMenu.x, window.innerWidth - 180),
            top: Math.min(contextMenu.y, window.innerHeight - 200),
          }}
        >
          <div style={s.ctxItem} onClick={() => { switchTab(contextMenu.chatId); setContextMenu(null) }}>
            Перейти в чат
          </div>
          <div style={s.ctxItem} onClick={() => { togglePinTab(contextMenu.chatId); setContextMenu(null) }}>
            {pinnedTabIds.has(contextMenu.chatId) ? 'Открепить' : 'Закрепить'}
          </div>
          <div style={s.ctxDivider} />
          <div style={s.ctxItem} onClick={() => closeOthers(contextMenu.chatId)}>
            Закрыть остальные
          </div>
          <div style={{ ...s.ctxItem, color: 'var(--text-danger, #e55)' }}
            onClick={() => { closeTab(contextMenu.chatId); setContextMenu(null) }}>
            Закрыть
          </div>
        </div>
      )}
    </>
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
  pinDot: {
    width: 5,
    height: 5,
    borderRadius: '50%',
    background: 'var(--accent)',
    flexShrink: 0,
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
  ctxMenu: {
    position: 'fixed',
    zIndex: 9999,
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: 7,
    boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
    minWidth: 168,
    padding: '4px 0',
  },
  ctxItem: {
    padding: '7px 14px',
    fontSize: 13,
    cursor: 'pointer',
    color: 'var(--text-primary)',
  },
  ctxDivider: {
    height: 1,
    background: 'var(--border)',
    margin: '3px 0',
  },
}
