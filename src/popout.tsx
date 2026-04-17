import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import ChatPopout, { PopoutData } from './pages/ChatPopout'
import './styles/global.css'
import { useStore } from './store'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

function PopoutApp() {
  const [popout, setPopout] = useState<PopoutData | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const label = getCurrentWindow().label
    invoke<any>('get_popout_data', { label })
      .then(data => {
        if (!data) { setError(true); return }

        // Применяем тему из данных
        if (data.theme) {
          document.documentElement.setAttribute('data-theme', data.theme)
          localStorage.setItem('soviet_theme', data.theme)
        }

        // Прайминг стора через setState() (без invoke — IPC готов)
        if (data.type === 'chat') {
          useStore.setState({
            activeChat: {
              id: data.chatId ?? -1,
              chat_type: 'direct',
              peer_key: data.peerKey ?? '',
              group_id: null,
              created_at: Date.now() / 1000,
              last_message: null,
              last_message_time: null,
              unread_count: 0,
              group_name: null,
            },
            messages: [],
            decryptedMessages: {},
            reactions: {},
          })
        } else if (data.type === 'channel') {
          useStore.setState({
            activeChannel: {
              channel_id: data.channelId ?? '',
              name: data.channelName ?? '',
              about: '',
              picture: '',
              creator_pubkey: '',
              relay: '',
              unread_count: 0,
              last_message: null,
              last_message_time: null,
            },
            channelMessages: [],
          })
        }

        setPopout(data as PopoutData)
      })
      .catch(e => {
        console.error('get_popout_data failed:', e)
        setError(true)
      })
  }, [])

  // Окно создаётся скрытым (.visible(false) в Rust).
  // Показываем его только после того как данные загружены и React отрендерил
  // контент — пользователь никогда не видит белый экран загрузки.
  useEffect(() => {
    if (popout || error) {
      getCurrentWindow().show().catch(() => {})
    }
  }, [popout, error])

  if (error) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text-primary)', background:'var(--bg-primary)' }}>
      Ошибка загрузки окна. Закройте и откройте снова.
    </div>
  )
  if (!popout) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text-muted)', background:'var(--bg-primary)' }}>
      Загрузка...
    </div>
  )
  return <ChatPopout data={popout} />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PopoutApp />
  </React.StrictMode>
)
