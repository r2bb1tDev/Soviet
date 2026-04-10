// sounds.ts — Web Audio API уведомления без внешних файлов
import { invoke } from '@tauri-apps/api/core'

export async function isSoundEnabled(): Promise<boolean> {
  try {
    const s = await invoke<any>('get_settings')
    return s?.notify_sounds !== false
  } catch { return false }
}

// ICQ-стиль: двойной тон для входящего сообщения / контакт-запроса
export function playNotificationBeep() {
  try {
    const ctx = new AudioContext()
    const osc1 = ctx.createOscillator()
    const osc2 = ctx.createOscillator()
    const gain = ctx.createGain()
    osc1.connect(gain); osc2.connect(gain); gain.connect(ctx.destination)
    osc1.type = 'sine'; osc2.type = 'sine'
    osc1.frequency.setValueAtTime(880, ctx.currentTime)
    osc2.frequency.setValueAtTime(1320, ctx.currentTime + 0.08)
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
    osc1.start(ctx.currentTime); osc1.stop(ctx.currentTime + 0.15)
    osc2.start(ctx.currentTime + 0.08); osc2.stop(ctx.currentTime + 0.4)
    setTimeout(() => ctx.close(), 600)
  } catch { /* AudioContext заблокирован — молча игнорируем */ }
}

// Тихий щелчок для исходящего сообщения (~300 мс)
export function playClickSound() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(1100, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 0.07)
    gain.gain.setValueAtTime(0.12, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09)
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.1)
    setTimeout(() => ctx.close(), 200)
  } catch { }
}

// Восходящий тон — контакт вошёл в сеть (~500 мс)
export function playOnlineSound() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(660, ctx.currentTime)
    osc.frequency.linearRampToValueAtTime(990, ctx.currentTime + 0.2)
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.4)
    setTimeout(() => ctx.close(), 600)
  } catch { }
}

// Нисходящий тон — контакт вышел из сети (~400 мс)
export function playOfflineSound() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(660, ctx.currentTime)
    osc.frequency.linearRampToValueAtTime(440, ctx.currentTime + 0.18)
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.07, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.35)
    setTimeout(() => ctx.close(), 500)
  } catch { }
}
