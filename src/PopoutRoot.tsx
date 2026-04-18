import { useEffect, useState } from 'react'
import ChatPopout, { PopoutData } from './pages/ChatPopout'
import { useStore } from './store'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

/**
 * Popout-окно: та же сборка что и главное (index.html + main.tsx), но
 * вместо <App/> рендерим этот компонент когда выставлен window.__sovietPopoutLabel.
 * Это надёжнее отдельного popout.html (который по неизвестным причинам
 * давал чёрное пустое окно в Tauri WebView).
 */
export default function PopoutRoot() {
  const [popout, setPopout] = useState<PopoutData | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    let label: string
    try {
      label = (window as any).__sovietPopoutLabel || getCurrentWindow().label
    } catch (e: any) {
      setErrorMsg(`getCurrentWindow failed: ${e?.message || e}`)
      return
    }

    invoke<any>('get_popout_data', { label })
      .then(data => {
        if (!data) {
          setErrorMsg(`Нет данных для окна "${label}". Возможно окно было создано до перезапуска приложения.`)
          return
        }

        if (data.theme) {
          document.documentElement.setAttribute('data-theme', data.theme)
          localStorage.setItem('soviet_theme', data.theme)
        }

        if (data.type === 'chat') {
          const isGroup = !data.peerKey
          useStore.setState({
            activeChat: {
              id: data.chatId ?? -1,
              chat_type: isGroup ? 'group' : 'direct',
              peer_key: data.peerKey ?? '',
              group_id: isGroup ? (data.chatId ?? null) : null,
              created_at: Date.now() / 1000,
              last_message: null,
              last_message_time: null,
              unread_count: 0,
              group_name: isGroup ? (data.peerName ?? null) : null,
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
        const msg = e?.message || String(e)
        console.error('get_popout_data failed:', e)
        setErrorMsg(`invoke(get_popout_data) failed: ${msg}`)
      })
  }, [])

  const theme = document.documentElement.getAttribute('data-theme')
  const bg = theme === 'light' ? '#F4FFF7' : '#0A0A0A'
  const fg = theme === 'light' ? '#0A0A0A' : '#F4FFF7'

  if (errorMsg) return (
    <div style={{
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      height:'100vh', padding:20, boxSizing:'border-box',
      background:bg, color:fg, gap:12, textAlign:'center',
    }}>
      <div style={{ fontSize:48 }}>⚠️</div>
      <div style={{ fontSize:16, fontWeight:600 }}>Ошибка загрузки окна</div>
      <div style={{ fontSize:12, opacity:0.75, maxWidth:420, wordBreak:'break-word' }}>{errorMsg}</div>
      <button onClick={() => window.close()} style={{
        marginTop:8, padding:'8px 20px', fontSize:13,
        background:'transparent', color:fg, border:`1px solid ${fg}`, borderRadius:6, cursor:'pointer',
      }}>Закрыть</button>
    </div>
  )
  if (!popout) return (
    <div style={{
      display:'flex', alignItems:'center', justifyContent:'center',
      height:'100vh', background:bg, color:fg, opacity:0.6, fontSize:13,
    }}>
      Загрузка…
    </div>
  )
  return <ChatPopout data={popout} />
}
