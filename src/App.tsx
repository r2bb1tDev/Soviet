import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { check as checkUpdate } from '@tauri-apps/plugin-updater'
import { useStore } from './store'
import Onboarding from './pages/Onboarding'
import Main from './pages/Main'
import Settings from './pages/Settings'
import ToastContainer from './components/Toast'
import KeyboardShortcuts from './components/KeyboardShortcuts'
import { isSoundEnabled, playNotificationBeep, playOnlineSound, playOfflineSound } from './utils/sounds'
import './styles/global.css'

export default function App() {
  const {
    page, setPage, loadIdentity, loadContacts, loadChats,
    loadLanPeers, loadP2pPeers, loadContactRequests, setMyStatus,
    loadMessages, setTyping, updateContactStatus,
    addToast, loadChannels, addChannelMessage,
    updateReaction, applyMessageEdit, applyMessageDelete,
    applyChannelEdit, applyChannelDelete, applyChannelReaction,
  } = useStore()
  const get = useStore.getState

  // Счётчик непрочитанных для заголовка окна
  const totalUnread = useStore(s =>
    s.chats.reduce((n, c) => n + (c.unread_count ?? 0), 0) +
    s.channels.reduce((n, c) => n + (c.unread_count ?? 0), 0)
  )
  useEffect(() => {
    document.title = totalUnread > 0
      ? `(${totalUnread > 99 ? '99+' : totalUnread}) Soviet`
      : 'Soviet'
  }, [totalUnread])

  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<any>(null)
  const [showShortcuts, setShowShortcuts] = useState(false)

  const checkForUpdates = async () => {
    try {
      const update = await checkUpdate()
      if (update) {
        setUpdateInfo(update)
        setUpdateAvailable(true)
        // Уведомить через трей и системное уведомление
        try {
          await invoke('set_tray_update_badge', { version: update.version ?? '' })
        } catch {}
        try {
          const { sendNotification } = await import('@tauri-apps/plugin-notification')
          sendNotification({
            title: '🐻 Soviet — доступно обновление',
            body: `Версия ${update.version ?? ''} готова к установке. Нажмите для обновления.`,
          })
        } catch {}
      }
    } catch (e) {
      console.warn('[updater] check failed:', e)
    }
  }

  const handleInstallUpdate = async () => {
    try {
      if (updateInfo) {
        await updateInfo.downloadAndInstall()
      }
    } catch (error) {
      console.error('[updater] install failed:', error)
      addToast({ type: 'error', title: 'Ошибка обновления', body: 'Не удалось установить обновление' })
    }
  }

  // Тема: сначала ОС, потом перезаписываем сохранённой настройкой
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const applyOS = (dark: boolean) =>
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    applyOS(mq.matches)
    mq.addEventListener('change', e => applyOS(e.matches))

    invoke<any>('get_settings').then(s => {
      const t = s?.theme ?? 'system'
      if (t === 'dark')  document.documentElement.setAttribute('data-theme', 'dark')
      if (t === 'light') document.documentElement.setAttribute('data-theme', 'light')
    }).catch(() => {})

    // Восстанавливаем масштаб и высокий контраст из localStorage
    const scale = localStorage.getItem('uiScale')
    if (scale) document.documentElement.style.zoom = `${scale}%`
    if (localStorage.getItem('highContrast') === 'true')
      document.documentElement.setAttribute('data-contrast', 'high')

    return () => mq.removeEventListener('change', e => applyOS(e.matches))
  }, [])

  // Горячие клавиши: Ctrl+F → поиск, Ctrl+N → новый чат
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('soviet:focus-search'))
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('soviet:new-chat'))
      }
      if (e.key === 'Escape') {
        setShowShortcuts(false)
        window.dispatchEvent(new CustomEvent('soviet:escape'))
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault()
        setShowShortcuts(v => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Экспортируем функции для вызова из трея через window.__tray*
  useEffect(() => {
    ;(window as any).__trayNavigate = (pg: string) => useStore.getState().setPage(pg as any)
    ;(window as any).__trayStatus   = (st: string) => useStore.getState().setMyStatus(st)
  }, [])

  // Загружаем идентичность при старте
  useEffect(() => { loadIdentity() }, [])

  // Проверка обновлений при старте и каждые 2 минуты
  useEffect(() => {
    checkForUpdates()
    const interval = setInterval(() => {
      if (!updateAvailable) checkForUpdates()
    }, 2 * 60 * 1000)
    return () => clearInterval(interval)
  }, [updateAvailable])

  // Показать диалог обновления при клике на трей (когда окно было скрыто)
  useEffect(() => {
    const unlisten = listen<string>('update-available-tray', () => {
      if (!updateAvailable) checkForUpdates()
    })
    return () => { unlisten.then(f => f()) }
  }, [updateAvailable])

  // Загружаем данные при открытии главного окна
  useEffect(() => {
    if (page === 'main') {
      loadContacts()
      loadChats()
      loadContactRequests()
      loadLanPeers()
      loadP2pPeers()
      loadChannels()
      // Периодическое обновление: пиры каждые 15 сек, контакты + чаты каждые 30 сек
      const intervalFast = setInterval(() => {
        loadLanPeers()
        loadP2pPeers()
      }, 15000)
      const intervalSlow = setInterval(() => {
        loadContacts()   // обновляем аватарки и статусы
        loadChats()      // обновляем превью последних сообщений
      }, 30000)
      return () => {
        clearInterval(intervalFast)
        clearInterval(intervalSlow)
      }
    }
  }, [page])

  // Tauri event listeners
  useEffect(() => {
    const preventCtx = (e: MouseEvent) => e.preventDefault()
    document.addEventListener('contextmenu', preventCtx)

    // ── Новое входящее сообщение ──────────────────────────────────────────────
    const unlisten1 = listen<{
      chat_id: number; msg_id: number
      sender_pk: string; sender_name: string; preview: string
    }>('new-message', async (e) => {
      const { chat_id, sender_pk, sender_name, preview } = e.payload
      // Сначала перезагружаем чаты чтобы создался chat с реальным id
      await loadChats()
      const { activeChat, setActiveChat } = useStore.getState()
      const isActive =
        activeChat?.id === chat_id ||
        activeChat?.peer_key === sender_pk ||
        (activeChat?.id === -1 && activeChat?.peer_key === sender_pk)
      if (isActive) {
        // Если чат был временным (id=-1), обновляем его реальным объектом
        if (activeChat?.id === -1) {
          const realChat = useStore.getState().chats.find(c => c.id === chat_id)
          if (realChat) setActiveChat(realChat)
        }
        loadMessages(chat_id)
      } else {
        addToast({ type: 'message', title: sender_name, body: preview, chatId: chat_id, senderPk: sender_pk })
        // Звуковое уведомление (ICQ-стиль)
        if (await isSoundEnabled()) playNotificationBeep()
        // Системное уведомление ОС (когда окно не в фокусе)
        if (document.visibilityState === 'hidden') {
          try {
            const { sendNotification } = await import('@tauri-apps/plugin-notification')
            sendNotification({ title: sender_name, body: preview })
          } catch { }
        }
      }
    })

    // ── Запрос контакта ───────────────────────────────────────────────────────
    const unlisten2 = listen<{ sender_pk: string; nickname: string }>('contact-request', async (e) => {
      loadContactRequests()
      addToast({ type: 'request', title: 'Запрос контакта',
        body: `${e.payload.nickname} хочет добавить вас в контакты`, senderPk: e.payload.sender_pk })
      if (await isSoundEnabled()) playNotificationBeep()
      if (document.visibilityState === 'hidden') {
        try {
          const { sendNotification } = await import('@tauri-apps/plugin-notification')
          sendNotification({ title: 'Запрос контакта', body: `${e.payload.nickname} хочет добавить вас в контакты` })
        } catch { }
      }
    })

    // ── Навигация из трея ─────────────────────────────────────────────────────
    const unlisten3 = listen<string>('navigate', (e) => setPage(e.payload as any))

    // ── Статус из трея ────────────────────────────────────────────────────────
    const unlisten4 = listen<string>('tray-status-change', (e) => setMyStatus(e.payload))

    // ── Индикатор набора ──────────────────────────────────────────────────────
    const unlisten5 = listen<{ sender_pk: string; is_typing: boolean }>('typing', (e) => {
      setTyping(e.payload.sender_pk, e.payload.is_typing)
    })

    // ── Статус контакта ───────────────────────────────────────────────────────
    const unlisten6 = listen<{ pk: string; status: string; status_text?: string; avatar?: string }>('contact-status', async (e) => {
      const prev = useStore.getState().contacts.find(c => c.public_key === e.payload.pk)?.status
      updateContactStatus(e.payload.pk, e.payload.status, e.payload.status_text, e.payload.avatar)
      if (await isSoundEnabled()) {
        if (e.payload.status === 'online' && prev !== 'online') playOnlineSound()
        else if (e.payload.status === 'offline' && prev === 'online') playOfflineSound()
      }
    })

    // ── Read receipt ──────────────────────────────────────────────────────────
    const unlisten7 = listen<{ peer_pk: string }>('read-receipt', (e) => {
      const { activeChat } = useStore.getState()
      if (activeChat?.peer_key === e.payload.peer_pk) {
        useStore.setState(s => ({
          messages: s.messages.map(m =>
            m.sender_key !== e.payload.peer_pk ? { ...m, status: 'read' as const } : m
          )
        }))
      }
    })

    // ── Nostr канал — входящее сообщение ──────────────────────────────────────
    const unlisten8 = listen<any>('nostr-message', (e) => {
      const { activeChannel } = useStore.getState()
      addChannelMessage(e.payload)
      if (activeChannel?.channel_id !== e.payload.channel_id && !e.payload.is_mine) {
        loadChannels()
      }
    })

    // ── Реакция на сообщение ──────────────────────────────────────────────────
    const unlistenR = listen<{ message_id: number; sender_pk: string; emoji: string; action: string }>('reaction-update', (e) => {
      updateReaction(e.payload.message_id, e.payload.sender_pk, e.payload.emoji, e.payload.action as 'add' | 'remove')
    })

    // ── Редактирование сообщения ──────────────────────────────────────────────
    const unlistenE = listen<{ message_id: number; new_content: string }>('message-edited', (e) => {
      applyMessageEdit(e.payload.message_id, e.payload.new_content)
    })

    // ── Удаление сообщения ────────────────────────────────────────────────────
    const unlistenD = listen<{ message_id: number }>('message-deleted', (e) => {
      applyMessageDelete(e.payload.message_id)
    })

    // ── Групповые события ─────────────────────────────────────────────────────
    const unlistenGI = listen<any>('group-invite', () => get().loadChats())

    const unlistenGM = listen<any>('group-message', async (e) => {
      const { activeChat } = useStore.getState()
      if (activeChat && activeChat.group_id === e.payload.group_id) {
        get().loadMessages(activeChat.id)
      } else {
        get().loadChats()
        addToast({ type: 'message', title: e.payload.sender_name, body: e.payload.preview, chatId: e.payload.chat_id })
        if (await isSoundEnabled()) playNotificationBeep()
        if (document.visibilityState === 'hidden') {
          try {
            const { sendNotification } = await import('@tauri-apps/plugin-notification')
            sendNotification({ title: e.payload.sender_name, body: e.payload.preview })
          } catch { }
        }
      }
    })

    const unlistenGL = listen<any>('group-left',     () => useStore.getState().loadChats())
    const unlistenGD = listen<{ group_id: string }>('group-dissolved', (e) => {
      const { activeChat, setActiveChat, loadChats } = useStore.getState()
      if (activeChat?.group_id === e.payload.group_id) setActiveChat(null)
      loadChats()
    })

    // ── Nostr канал — правки, удаления, реакции ───────────────────────────────
    const unlistenCE  = listen<{ event_id: string; new_content: string; edited_at: number }>('nostr-message-edited', (e) => {
      applyChannelEdit(e.payload.event_id, e.payload.new_content, e.payload.edited_at)
    })
    const unlistenCDl = listen<{ event_id: string }>('nostr-message-deleted', (e) => {
      applyChannelDelete(e.payload.event_id)
    })
    const unlistenCR  = listen<any>('nostr-reaction', (e) => applyChannelReaction(e.payload))
    const unlistenCD  = listen<{ channel_id: string }>('nostr-channel-deleted', (e) => {
      const st = useStore.getState()
      if (st.activeChannel?.channel_id === e.payload.channel_id) {
        useStore.setState({ activeChannel: null, channelMessages: [] })
      }
      useStore.setState(s => ({ channels: s.channels.filter(c => c.channel_id !== e.payload.channel_id) }))
    })

    // ── P2P события (mDNS / Kademlia DHT) ────────────────────────────────────
    const unlistenP2pOn  = listen<{ peer_id: string; soviet_pk: string }>('p2p-peer-online', () => {
      useStore.getState().loadP2pPeers()
    })
    const unlistenP2pOff = listen<{ peer_id: string; soviet_pk: string }>('p2p-peer-offline', () => {
      useStore.getState().loadP2pPeers()
    })
    // backward compat aliases
    const unlistenP2pF   = listen<any>('p2p-peer-found', () => useStore.getState().loadP2pPeers())
    const unlistenP2pL   = listen<any>('p2p-peer-lost',  () => useStore.getState().loadP2pPeers())

    // ── Outbox delivery confirmation ──────────────────────────────────────────
    const unlistenOB = listen<{ msg_id: number; status: string }>('outbox-updated', () => {
      loadChats()
    })

    return () => {
      document.removeEventListener('contextmenu', preventCtx)
      ;[
        unlisten1, unlisten2, unlisten3, unlisten4, unlisten5,
        unlisten6, unlisten7, unlisten8,
        unlistenR, unlistenE, unlistenD,
        unlistenGI, unlistenGM, unlistenGL, unlistenGD,
        unlistenCE, unlistenCDl, unlistenCR, unlistenCD,
        unlistenP2pOn, unlistenP2pOff, unlistenP2pF, unlistenP2pL,
        unlistenOB,
      ].forEach(p => p.then(f => f()))
    }
  }, [])

  return (
    <>
      {page === 'onboarding' && <Onboarding />}
      {page === 'settings'   && <Settings />}
      {page === 'main'       && <Main />}

      {updateAvailable && updateInfo && (
        <div style={{
          position: 'fixed', inset: 0,
          backgroundColor: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 10000,
        }}>
          <div style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            borderRadius: 10, padding: '24px 28px',
            maxWidth: 380, textAlign: 'center',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🐻</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Доступно обновление</div>
            <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>
              Версия {updateInfo.version}
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 20 }}>
              {updateInfo.body || 'Новая версия готова к установке.'}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={() => setUpdateAvailable(false)} style={btnSecondary}>
                Позже
              </button>
              <button onClick={handleInstallUpdate} style={btnPrimary}>
                Установить
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer />
      {showShortcuts && <KeyboardShortcuts onClose={() => setShowShortcuts(false)} />}
    </>
  )
}

const btnPrimary: React.CSSProperties = {
  padding: '8px 20px', backgroundColor: 'var(--accent)',
  color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600,
}
const btnSecondary: React.CSSProperties = {
  padding: '8px 20px', backgroundColor: 'transparent',
  color: 'var(--text-primary)', border: '1px solid var(--border)',
  borderRadius: 6, cursor: 'pointer',
}
