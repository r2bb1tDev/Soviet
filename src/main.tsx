import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ChatPopout from './pages/ChatPopout'
import './styles/global.css'
import { useStore } from './store'

const popout = (window as any).__POPOUT__

// Прайминг Zustand-стора ДО первого рендера React — иначе ChatWindow возвращает null
// (activeChat === null) на первом рендере и пользователь видит белое окно навсегда.
if (popout) {
  const { setActiveChat, setActiveChannel } = useStore.getState()
  if (popout.type === 'chat') {
    setActiveChat({
      id: popout.chatId ?? -1,
      chat_type: 'direct',
      peer_key: popout.peerKey ?? '',
      group_id: null,
      created_at: Date.now() / 1000,
      last_message: null,
      last_message_time: null,
      unread_count: 0,
      group_name: null,
    })
  } else if (popout.type === 'channel') {
    setActiveChannel({
      channel_id: popout.channelId ?? '',
      name: popout.channelName ?? '',
      about: '',
      picture: '',
      creator_pubkey: '',
      relay: '',
      unread_count: 0,
      last_message: null,
      last_message_time: null,
    })
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {popout ? <ChatPopout data={popout} /> : <App />}
  </React.StrictMode>
)
