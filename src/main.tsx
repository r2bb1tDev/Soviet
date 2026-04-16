import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ChatPopout from './pages/ChatPopout'
import { PopoutData } from './pages/ChatPopout'
import './styles/global.css'
import { useStore } from './store'

// Читаем данные попаута из sessionStorage.
// initialization_script записывает туда JSON ДО загрузки Vite runtime.
// sessionStorage переживает Vite HMR (HMR заменяет JS-модули без перезагрузки страницы),
// поэтому данные остаются доступными когда этот модуль выполняется.
function getPopoutData(): PopoutData | null {
  try {
    const raw = sessionStorage.getItem('__soviet_popout__')
    if (!raw) return null
    const d = JSON.parse(raw)
    if (d?.type === 'chat' || d?.type === 'channel') return d as PopoutData
  } catch {}
  return null
}

const popout = getPopoutData()

// Прайминг Zustand-стора ДО первого рендера React через setState() (без invoke).
// setActiveChat/setActiveChannel немедленно вызывают invoke() — до готовности Tauri IPC.
// setState() только пишет данные, без IPC-вызовов.
if (popout) {
  if (popout.type === 'chat') {
    useStore.setState({
      activeChat: {
        id: popout.chatId ?? -1,
        chat_type: 'direct',
        peer_key: popout.peerKey ?? '',
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
  } else if (popout.type === 'channel') {
    useStore.setState({
      activeChannel: {
        channel_id: popout.channelId ?? '',
        name: popout.channelName ?? '',
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
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {popout ? <ChatPopout data={popout} /> : <App />}
  </React.StrictMode>
)
