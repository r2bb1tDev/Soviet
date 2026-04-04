import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { checkUpdate } from '@tauri-apps/plugin-updater'
import { useStore } from './store'
import Onboarding from './pages/Onboarding'
import Main from './pages/Main'
import Settings from './pages/Settings'
import ToastContainer from './components/Toast'
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

  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<any>(null)

  const checkForUpdates = async () => {
    try {
      const update = await checkUpdate()
      if (update.shouldUpdate) {
        setUpdateInfo(update)
        setUpdateAvailable(true)
      }
    } catch (error) {
      console.error('Update check failed:', error)
    }
  }

  const handleInstallUpdate = async () => {
    if (updateInfo) {
      try {
        await updateInfo.install()
        // Приложение перезапустится автоматически после установки
      } catch (error) {
        console.error('Update installation failed:', error)
        addToast({ type: 'error', title: 'Ошибка обновления', body: 'Не удалось установить обновление' })
      }
    }
  }

  const handleLater = () => {
    setUpdateAvailable(false)
  }

  // Тема: сначала ОС, потом перезаписываем сохранённой настройкой
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const applyOS = (dark: boolean) =>
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    applyOS(mq.matches)
    mq.addEventListener('change', e => applyOS(e.matches))

    // Загружаем сохранённую тему из БД
    invoke<any>('get_settings').then(s => {
      const t = s?.theme ?? 'system'
      if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
      else if (t === 'light') document.documentElement.setAttribute('data-theme', 'light')
      // 'system' — уже применена выше через mq
    }).catch(() => {})

    return () => mq.removeEventListener('change', e => applyOS(e.matches))
  }, [])

  // Экспортируем функции для вызова из трея через window.eval()
  useEffect(() => {
    ;(window as any).__trayNavigate = (page: string) => { useStore.getState().setPage(page as any) }
    ;(window as any).__trayStatus   = (status: string) => { useStore.getState().setMyStatus(status) }
  }, [])

  // Загружаем идентичность при старте
  useEffect(() => { loadIdentity() }, [])

  // Проверка обновлений при старте и каждые 2 минуты
  useEffect(() => {
    checkForUpdates() // Проверяем сразу при старте

    const interval = setInterval(() => {
      if (!updateAvailable) { // Проверяем только если уведомление скрыто
        checkForUpdates()
      }
    }, 2 * 60 * 1000) // 2 минуты

    return () => clearInterval(interval)
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
      const interval = setInterval(() => {
        loadLanPeers()
        loadP2pPeers()
      }, 15000)
      return () => clearInterval(interval)
    }
  }, [page])

  // Tauri event listeners
  useEffect(() => {
    const preventCtx = (e: MouseEvent) => e.preventDefault()
    document.addEventListener('contextmenu', preventCtx)

    // Новое входящее сообщение (уже сохранено в БД бэкендом)
    const unlisten1 = listen<{
      chat_id: number
      msg_id: number
      sender_pk: string
      sender_name: string
      preview: string
    }>('new-message', (e) => {
      const { chat_id, sender_pk, sender_name, preview } = e.payload
      // Обновляем список чатов
      loadChats()
      // Если сейчас открыт этот чат — перезагружаем сообщения
      const { activeChat } = useStore.getState()
      if (activeChat?.id === chat_id || activeChat?.peer_key === sender_pk) {
        loadMessages(chat_id)
      } else {
        // Показываем уведомление
        addToast({
          type: 'message',
          title: sender_name,
          body: preview,
          chatId: chat_id,
          senderPk: sender_pk,
        })
      }
    })

    // Запрос на добавление в контакты
    const unlisten2 = listen<{ sender_pk: string; nickname: string }>('contact-request', (e) => {
      loadContactRequests()
      addToast({
        type: 'request',
        title: 'Запрос контакта',
        body: `${e.payload.nickname} хочет добавить вас в контакты`,
        senderPk: e.payload.sender_pk,
      })
    })

    // Навигация из трея
    const unlisten3 = listen<string>('navigate', (e) => {
      setPage(e.payload as any)
    })

    // Смена статуса из трея
    const unlisten4 = listen<string>('tray-status-change', (e) => {
      setMyStatus(e.payload)
    })

    // Индикатор набора
    const unlisten5 = listen<{ sender_pk: string; is_typing: boolean }>('typing', (e) => {
      setTyping(e.payload.sender_pk, e.payload.is_typing)
    })

    // Обновление статуса контакта
    const unlisten6 = listen<{ pk: string; status: string }>('contact-status', (e) => {
      updateContactStatus(e.payload.pk, e.payload.status)
    })

    // Приглашение в группу
    const unlistenG = listen<{ group_id: string; group_name: string; sender_pk: string }>('group-invite', () => {
      get().loadChats()
    })

    // Новое сообщение в группу
    const unlistenGM = listen<any>('group-message', (e) => {
      const { activeChat } = useStore.getState()
      if (activeChat && activeChat.group_id === e.payload.group_id) {
        get().loadMessages(activeChat.id)
      } else {
        get().loadChats()
        addToast({ type: 'message', title: e.payload.sender_name, body: e.payload.preview, chatId: e.payload.chat_id })
      }
    })

    // Read receipt — собеседник прочитал наши сообщения
    const unlisten7 = listen<{ peer_pk: string }>('read-receipt', (e) => {
      const { activeChat } = useStore.getState()
      if (activeChat?.peer_key === e.payload.peer_pk) {
        // Обновляем статус наших сообщений в текущем чате на "read"
        useStore.setState(s => ({
          messages: s.messages.map(m =>
            m.sender_key !== e.payload.peer_pk ? { ...m, status: 'read' as const } : m
          )
        }))
      }
    })

    // Входящее сообщение Nostr-канала
    const unlisten8 = listen<any>('nostr-message', (e) => {
      const { activeChannel } = useStore.getState()
      addChannelMessage(e.payload)
      if (activeChannel?.channel_id !== e.payload.channel_id && !e.payload.is_mine) {
        loadChannels()
      }
    })

    // Реакция на сообщение
    const unlistenR = listen<{ message_id: number; sender_pk: string; emoji: string; action: string }>('reaction-update', (e) => {
      updateReaction(e.payload.message_id, e.payload.sender_pk, e.payload.emoji, e.payload.action as 'add' | 'remove')
    })

    // Редактирование сообщения
    const unlistenE = listen<{ message_id: number; new_content: string }>('message-edited', (e) => {
      applyMessageEdit(e.payload.message_id, e.payload.new_content)
    })

    // Удаление сообщения
    const unlistenD = listen<{ message_id: number }>('message-deleted', (e) => {
      applyMessageDelete(e.payload.message_id)
    })

    // Участник покинул группу
    const unlistenGL = listen<{ group_id: string; chat_id?: number }>('group-left', () => {
      useStore.getState().loadChats()
    })

    // Группа распущена
    const unlistenGD = listen<{ group_id: string }>('group-dissolved', (e) => {
      const { activeChat, setActiveChat, loadChats } = useStore.getState()
      if (activeChat?.group_id === e.payload.group_id) setActiveChat(null)
      loadChats()
    })

    // Nostr сообщение отредактировано
    const unlistenCE = listen<{ event_id: string; new_content: string; edited_at: number }>('nostr-message-edited', (e) => {
      applyChannelEdit(e.payload.event_id, e.payload.new_content, e.payload.edited_at)
    })

    // Nostr сообщение удалено
    const unlistenCDel = listen<{ event_id: string }>('nostr-message-deleted', (e) => {
      applyChannelDelete(e.payload.event_id)
    })

    // Nostr реакция
    const unlistenCR = listen<any>('nostr-reaction', (e) => {
      applyChannelReaction(e.payload)
    })

    // Nostr канал удалён (создателем или подпиской)
    const unlistenCD = listen<{ channel_id: string }>('nostr-channel-deleted', (e) => {
      const st = useStore.getState()
      if (st.activeChannel?.channel_id === e.payload.channel_id) {
        useStore.setState({ activeChannel: null, channelMessages: [] })
      }
      useStore.setState(s => ({ channels: s.channels.filter(c => c.channel_id !== e.payload.channel_id) }))
    })

    // P2P: новый пир найден (mDNS или DHT)
    const unlistenP2pFound = listen<{ peer_id: string; source: string }>('p2p-peer-found', () => {
      useStore.getState().loadP2pPeers()
    })

    // P2P: пир ушёл офлайн
    const unlistenP2pLost = listen<{ peer_id: string }>('p2p-peer-lost', () => {
      useStore.getState().loadP2pPeers()
    })

    return () => {
      document.removeEventListener('contextmenu', preventCtx)
      unlisten1.then(f => f())
      unlisten2.then(f => f())
      unlisten3.then(f => f())
      unlisten4.then(f => f())
      unlisten5.then(f => f())
      unlisten6.then(f => f())
      unlisten7.then(f => f())
      unlisten8.then(f => f())
      unlistenG.then(f => f())
      unlistenGM.then(f => f())
      unlistenR.then(f => f())
      unlistenE.then(f => f())
      unlistenD.then(f => f())
      unlistenGL.then(f => f())
      unlistenGD.then(f => f())
      unlistenCD.then(f => f())
      unlistenCE.then(f => f())
      unlistenCDel.then(f => f())
      unlistenCR.then(f => f())
      unlistenP2pFound.then(f => f())
      unlistenP2pLost.then(f => f())
    }
  }, [])

  return (
    <>
      {page === 'onboarding' && <Onboarding />}
      {page === 'settings'   && <Settings />}
      {page === 'main'       && <Main />}

      {updateAvailable && updateInfo && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }}>
          <div style={{
            backgroundColor: 'var(--bg-color)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '20px',
            maxWidth: '400px',
            textAlign: 'center'
          }}>
            <h3>Доступно обновление</h3>
            <p>Версия {updateInfo.manifest?.version}</p>
            <p>{updateInfo.manifest?.body || 'Новая версия приложения доступна для установки.'}</p>
            <div style={{ marginTop: '20px', display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                onClick={handleLater}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'var(--button-bg)',
                  color: 'var(--button-text)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Позже
              </button>
              <button
                onClick={handleInstallUpdate}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'var(--accent-color)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Установить
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer />
    </>
  )
}
