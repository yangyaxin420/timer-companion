/* ============================================================
   专注伴伴 - Timer Companion PWA
   ============================================================ */

// ===== API Key management =====
const KeyManager = {
  get() { return localStorage.getItem('deepseek_api_key') || '' },
  set(key) { localStorage.setItem('deepseek_api_key', key.trim()) },
  has() { return !!this.get() }
}

// ===== API fetch helper =====
const API = {
  async chat(messages) {
    const key = KeyManager.get()
    const endpoint = 'https://api.deepseek.com/chat/completions'
    if (!key) return null
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: messages,
          max_tokens: 60,
          temperature: 0.8
        })
      })
      if (!res.ok) throw new Error(`API ${res.status}`)
      const data = await res.json()
      return data.choices?.[0]?.message?.content?.trim() || null
    } catch (e) {
      console.warn('API 请求失败:', e)
      return null
    }
  }
}

// ===== IndexedDB =====
const DB = {
  _db: null,
  async open() {
    if (this._db) return this._db
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('FocusCompanion', 1)
      req.onupgradeneeded = e => {
        const db = e.target.result
        if (!db.objectStoreNames.contains('sessions')) {
          const store = db.createObjectStore('sessions', { keyPath: 'id' })
          store.createIndex('date', 'date', { unique: false })
        }
      }
      req.onsuccess = e => { this._db = e.target.result; resolve(this._db) }
      req.onerror = e => reject(e.target.error)
    })
  },
  async saveSession(session) {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite')
      tx.objectStore('sessions').add(session)
      tx.oncomplete = () => resolve(session)
      tx.onerror = e => reject(e.target.error)
    })
  },
  async getAllSessions() {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readonly')
      const all = tx.objectStore('sessions').getAll()
      all.onsuccess = () => resolve(all.result || [])
      all.onerror = e => reject(e.target.error)
    })
  },
  async getStats(sessions) {
    if (!sessions) sessions = await this.getAllSessions()
    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7)) // Monday start
    weekStart.setHours(0,0,0,0)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const sum = arr => arr.reduce((a, b) => a + b, 0)

    const filter = (sessions, from) => sessions.filter(s => s.date >= from.getTime())

    return {
      all: {
        total: sessions.length,
        totalTime: sum(sessions.map(s => s.duration))
      },
      week: {
        total: filter(sessions, weekStart).length,
        totalTime: sum(filter(sessions, weekStart).map(s => s.duration))
      },
      month: {
        total: filter(sessions, monthStart).length,
        totalTime: sum(filter(sessions, monthStart).map(s => s.duration))
      }
    }
  }
}

// ===== Ringtone =====
// 方案1: 真实文件 bell.wav → HTMLAudioElement（最基础直接）
// 方案2: Web Audio buffer（解码/合成）
// 方案3: 即时合成 buffer / 振荡器
// 方案4: 振动保底
const Ringtone = {
  _audioCtx: null,
  _customData: null,
  _customBuffer: null,
  _defaultBuffer: null,
  _defaultEl: null,
  _storageKey: 'timer_ringtone',
  _unlocked: false,

  init() {
    this._customData = localStorage.getItem(this._storageKey) || null
    this._defaultEl = new Audio('./bell.wav')
    this._defaultEl.volume = 0.6
    this._updateUI()
  },

  getCtx() {
    if (!this._audioCtx) {
      const C = window.AudioContext || window.webkitAudioContext
      if (C) this._audioCtx = new C()
    }
    return this._audioCtx
  },

  unlock() {
    if (this._unlocked) return
    const ctx = this.getCtx()
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {})
      try {
        const sr = ctx.sampleRate, len = Math.floor(sr * 0.05)
        const buf = ctx.createBuffer(1, len, sr)
        const d = buf.getChannelData(0)
        for (let i = 0; i < len; i++) d[i] = Math.sin(2 * Math.PI * 440 * i / sr) * 0.03
        const n = ctx.createBufferSource()
        n.buffer = buf; n.connect(ctx.destination); n.start()
      } catch {}
    }

    // 预加载默认铃声 Audio 元素
    if (this._defaultEl) {
      this._defaultEl.load()
      this._defaultEl.play().then(() => { this._defaultEl.pause(); this._defaultEl.currentTime = 0 }).catch(() => {})
    }

    // 预生成 buffer（回退用）
    if (!this._defaultBuffer) this._defaultBuffer = this._genDefaultBuffer()
    if (this._customData && !this._customBuffer) {
      this._decodeDataUrl(this._customData).then(b => { this._customBuffer = b })
    }
    this._unlocked = true
  },

  async _decodeDataUrl(dataUrl) {
    try {
      const ctx = this._audioCtx
      if (!ctx) return null
      const resp = await fetch(dataUrl)
      const ab = await resp.arrayBuffer()
      return await ctx.decodeAudioData(ab)
    } catch { return null }
  },

  _genDefaultBuffer() {
    const ctx = this._audioCtx
    if (!ctx) return null
    const sr = ctx.sampleRate, dur = 0.5, len = Math.floor(sr * dur)
    const buf = ctx.createBuffer(1, len, sr)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) {
      const t = i / sr
      d[i] = Math.sin(2 * Math.PI * (t < 0.25 ? 880 : 1320) * t) * 0.3 * Math.max(0, 1 - t / dur)
    }
    return buf
  },

  hasCustom() { return !!this._customData },
  getName() {
    if (!this._customData) return '默认铃声'
    try {
      const info = this._customData.split(',')[0]
      const mime = info.split(':')[1]?.split(';')[0] || ''
      const names = { 'audio/mpeg': 'MP3', 'audio/wav': 'WAV', 'audio/mp4': 'M4A', 'audio/ogg': 'OGG', 'audio/webm': 'WebM', 'audio/x-m4a': 'M4A' }
      return `已上传 · ${names[mime] || '音频'}`
    } catch { return '已上传' }
  },
  getSize() {
    if (!this._customData) return 0
    return Math.round((this._customData.length * 3) / 4 / 1024)
  },

  save(dataUrl) {
    this._customData = dataUrl
    this._customBuffer = null
    localStorage.setItem(this._storageKey, dataUrl)
    this._decodeDataUrl(dataUrl).then(b => { this._customBuffer = b })
    this._updateUI()
  },

  reset() {
    this._customData = null
    this._customBuffer = null
    localStorage.removeItem(this._storageKey)
    this._updateUI()
  },

  _updateUI() {
    const el = document.getElementById('ringtone-status')
    if (!el) return
    el.textContent = this.getName()
    if (this.hasCustom()) {
      const size = this.getSize()
      el.textContent += `（${size}KB）`
    }
    const resetBtn = document.getElementById('ringtone-reset-btn')
    if (resetBtn) resetBtn.style.display = this.hasCustom() ? '' : 'none'
  },

  async play() {
    // === 方案1: 真实文件 bell.wav（HTTPS 真实路径，最可靠）===
    if (this._defaultEl) {
      try {
        this._defaultEl.currentTime = 0
        await this._defaultEl.play()
        if (navigator.vibrate) navigator.vibrate(200)
        return
      } catch (e) { console.warn('× bell.wav', e) }
    }

    // === 方案2: 自定义铃声 data URL ===
    if (this._customData) {
      try {
        const a = new Audio(this._customData)
        a.volume = 0.6; await a.play()
        if (navigator.vibrate) navigator.vibrate(200)
        return
      } catch (e) { console.warn('× customData', e) }
    }

    // === 方案3: Web Audio API ===
    const ctx = this._audioCtx || this.getCtx()
    if (ctx) {
      try { if (ctx.state === 'suspended') await ctx.resume() } catch {}

      // buffer（自定义优先）
      const buf = this._customBuffer || this._defaultBuffer
      if (buf) {
        try {
          const src = ctx.createBufferSource()
          src.buffer = buf; src.connect(ctx.destination); src.start()
          if (navigator.vibrate) navigator.vibrate(200)
          return
        } catch (e) { console.warn('× buf', e) }
      }

      // 即时合成
      try {
        const sr = ctx.sampleRate, len = Math.floor(sr * 0.3)
        const b = ctx.createBuffer(1, len, sr)
        const d = b.getChannelData(0)
        for (let i = 0; i < len; i++) d[i] = Math.sin(2 * Math.PI * 880 * i / sr) * 0.25
        const src = ctx.createBufferSource()
        src.buffer = b; src.connect(ctx.destination); src.start()
        if (navigator.vibrate) navigator.vibrate(200)
        return
      } catch (e) { console.warn('× synth', e) }

      // 振荡器
      try {
        const now = ctx.currentTime
        const o = ctx.createOscillator(), g = ctx.createGain()
        o.connect(g).connect(ctx.destination)
        o.type = 'sine'; o.frequency.value = 880
        g.gain.setValueAtTime(0.3, now)
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.5)
        o.start(now); o.stop(now + 0.5)
        if (navigator.vibrate) navigator.vibrate(200)
        return
      } catch (e) { console.warn('× osc', e) }
    }

    // === 保底振动 ===
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200])
  },

  async preview() {
    this.unlock()
    await this.play()
  },

  handleFile(file) {
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      alert('文件过大，请选择 2MB 以内的音频')
      return
    }
    const reader = new FileReader()
    reader.onload = e => {
      this.save(e.target.result)
      alert('铃声已保存')
    }
    reader.onerror = () => alert('读取失败')
    reader.readAsDataURL(file)
  }
}

// ===== Navigation =====
const Nav = {
  show(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
    const page = document.getElementById('page-' + pageId)
    if (page) page.classList.add('active')
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'))
    const navItem = document.querySelector(`[data-page="${pageId}"]`)
    if (navItem) navItem.classList.add('active')

    // landscape hint applies everywhere
    document.querySelector('.rotate-hint')?.classList.remove('show')
  },
}

// ===== Timer =====
const Timer = {
  _interval: null,
  _startTime: null,
  state: {
    running: false,
    mode: 'countdown',
    duration: 25 * 60,
    remaining: 25 * 60,
    elapsed: 0,
    taskName: ''
  },

  start(taskName, duration, mode) {
    this.state = { running: true, mode, duration, remaining: duration, elapsed: 0, taskName }
    this._startTime = Date.now()
    this._interval = setInterval(() => this._tick(), 100)
    this._updateDisplay()
    Bubbles.start()
    // 提前唤醒音频 + 预渲染铃声（点"开始专注"时有用户手势）
    Ringtone.unlock()
  },

  stop() {
    this.state.running = false
    clearInterval(this._interval)
    Bubbles.stop()
    document.querySelector('.rotate-hint')?.classList.remove('show')
    return this._getResult()
  },

  _tick() {
    const elapsed = Math.floor((Date.now() - this._startTime) / 1000)
    this.state.elapsed = elapsed
    this.state.remaining = Math.max(0, this.state.duration - elapsed)
    this._updateDisplay()
    if (this.state.mode === 'countdown' && this.state.remaining <= 0) {
      this._finish()
    }
  },

  _updateDisplay() {
    const display = this.state.mode === 'countdown' ? this.state.remaining : this.state.elapsed
    const el = document.getElementById('timer-display')
    if (el) el.textContent = this._formatTime(display)

    // Status line: brief info
    const statusLine = document.getElementById('timer-status-line')
    if (statusLine) {
      if (this.state.mode === 'countdown') {
        statusLine.textContent = this.state.taskName + '  ·  ' + this._formatTime(this.state.duration)
      } else {
        statusLine.textContent = this.state.taskName + '  ·  正计时'
      }
    }
  },

  _formatTime(secs) {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  },

  _finish() {
    this.state.running = false
    clearInterval(this._interval)
    this._notify()
    Ringtone.play()   // 🔔 响铃
    Bubbles.stop()
    document.querySelector('.rotate-hint')?.classList.remove('show')

    const result = this._getResult()
    this._showEndScreen(result)
  },

  _notify() {
    if (!('Notification' in window)) return
    if (Notification.permission === 'granted') {
      new Notification('时间到', { body: `「${this.state.taskName}」已完成` })
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission()
    }
  },

  _getResult() {
    const duration = this.state.mode === 'countdown'
      ? Math.min(this.state.elapsed, this.state.duration)
      : this.state.elapsed
    return {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
      taskName: this.state.taskName,
      duration,
      mode: this.state.mode,
      date: Date.now(),
      chats: Bubbles.getChats()
    }
  },

  _showEndScreen(result) {
    document.getElementById('end-task').textContent = result.taskName
    document.getElementById('end-duration').textContent = this._formatTime(result.duration)
    document.getElementById('end-mode').textContent = result.mode === 'countdown' ? '倒计时完成' : '计时结束'
    document.getElementById('end-bubble-count').textContent = `共 ${(result.chats||[]).length} 条`

    const chatLog = document.getElementById('end-chat-log')
    chatLog.innerHTML = (result.chats||[]).map(c =>
      `<div class="chat-msg ai">${c.text}<div class="chat-msg-time" style="font-size:11px;color:var(--text-light);margin-top:4px;">${c.time}</div></div>`
    ).join('') || '<div style="color:var(--text-light);text-align:center;">暂无 AI 回复</div>'

    document.getElementById('end-save').dataset.result = JSON.stringify(result)
    document.getElementById('end-save').textContent = '保存记录'
    Nav.show('end')
  }
}

// ===== AI Bubbles =====
const Bubbles = {
  _interval: null,
  _chats: [],
  _intervalSec: 0,
  _storageKey: 'timer_companion_chats',

  _loadChats() {
    try {
      const data = localStorage.getItem(this._storageKey)
      if (data) this._chats = JSON.parse(data)
      else this._chats = []
    } catch { this._chats = [] }
  },

  _saveChats() {
    try {
      localStorage.setItem(this._storageKey, JSON.stringify(this._chats))
    } catch {}
  },

  start() {
    this._loadChats()
    this._intervalSec = Math.floor(Math.random() * 120 + 90)
    this._intervalSec = Math.floor(Math.random() * 120 + 90) // 1.5 - 3.5 min
    setTimeout(() => this._generate(), 5000)
    this._interval = setInterval(() => this._generate(), this._intervalSec * 1000)
  },

  stop() {
    clearInterval(this._interval)
    this._interval = null
    document.querySelectorAll('.bubble').forEach(b => b.remove())
  },

  async _generate() {
    if (!Timer.state.running) return
    const text = await this._fetchAI()
    if (text) {
      this._chats.push({
        role: 'ai',
        text,
        time: new Date().toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'})
      })
      this._saveChats()
      this._showBubble(text)
    }
  },

  async _fetchAI() {
    const msg = this._buildPrompt()
    const result = await API.chat([
      { role: 'system', content: '你是骆云影 傲娇暴躁嘴硬心软 用最简洁带刺的话催用户专注 表面嫌弃刻薄实际在盯着有没有偷懒 20字以内 每次不重复 不要标点' },
      { role: 'user', content: msg }
    ])
    if (result) return result

    // Fallback messages - 骆云影版
    const messages = [
      '别磨蹭 赶紧的',
      '还行 没白等',
      '啧 总算有点样子',
      '认真起来倒是能看',
      '今天还行 没偷懒',
      '还剩一点 别断在这',
      '做得还行 别得意',
      '专心做事 少想有的没的',
      '我看着呢 别想偷懒',
      '急也没用 慢慢来',
      '还行嘛 没我想的那么弱',
      '有进步 别骄傲',
      '啧 这么拼给谁看',
      '没偷懒 算你懂事'
    ]
    const used = this._chats.slice(-3).map(c => c.text)
    const avail = messages.filter(m => !used.includes(m))
    return (avail.length ? avail : messages)[Math.floor(Math.random() * (avail.length || messages.length))]
  },

  _buildPrompt() {
    const elapsed = Timer.state.elapsed
    const minutes = Math.floor(elapsed / 60)
    const totalMin = Math.floor(Timer.state.duration / 60)
    return `任务「${Timer.state.taskName}」已进行 ${minutes} 分钟（共 ${totalMin} 分钟）。用你的方式说句话。`
  },

  _showBubble(text) {
    const container = document.getElementById('bubble-container')
    if (!container) return
    const bubble = document.createElement('div')
    bubble.className = 'bubble fade-in'
    bubble.textContent = text
    const off = Math.random() * 16 - 8
    bubble.style.marginLeft = off + '%'
    container.appendChild(bubble)
    bubble.addEventListener('click', () => this._showChatModal())
    setTimeout(() => bubble.remove(), 6000)
  },

  _showChatModal() {
    const modal = document.getElementById('chat-modal')
    this._renderChat()
    modal.classList.add('open')
    // 聚焦输入框
    setTimeout(() => document.getElementById('chat-input')?.focus(), 100)
  },

  _renderChat() {
    const body = document.getElementById('chat-modal-body')
    if (!body) return
    body.innerHTML = this._chats.length
      ? this._chats.map(c =>
          `<div class="chat-msg ${c.role}">${c.text}<div class="chat-msg-time">${c.time}</div></div>`
        ).join('')
      : '<div style="color:var(--text-light);text-align:center;padding:40px 0;">暂无消息</div>'
    body.scrollTop = body.scrollHeight
  },

  async _sendMessage(text) {
    if (!text.trim()) return
    const input = document.getElementById('chat-input')
    if (input) { input.value = ''; input.disabled = true }

    // 保存用户消息
    this._chats.push({
      role: 'user',
      text: text.trim(),
      time: new Date().toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'})
    })
    this._saveChats()
    this._renderChat()

    // 构建对话上下文
    const chatHistory = this._chats.map(c => ({
      role: c.role === 'user' ? 'user' : 'assistant',
      content: c.text
    }))

    const chatSystemPrompt = '你是骆云影 黑色中长发灰蓝色眼睛178cm ISTP 傲娇暴躁毒舌刻薄嘴硬心软 说话简洁冷淡带刺但偶尔透出关心 讨厌肉麻废话 现在用户主动找你聊天 你可以多说几句 不用限制字数 但别啰嗦 别加标点'

    const result = await API.chat([
      { role: 'system', content: chatSystemPrompt },
      ...chatHistory
    ])

    if (result) {
      this._chats.push({
        role: 'ai',
        text: result,
        time: new Date().toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'})
      })
    } else {
      // 回退
      const fallbacks = ['啧 回我干嘛 不用专注', '有事说事', '…干嘛']
      this._chats.push({
        role: 'ai',
        text: fallbacks[Math.floor(Math.random() * fallbacks.length)],
        time: new Date().toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'})
      })
    }
    this._saveChats()
    this._renderChat()
    if (input) input.disabled = false
  },

  getChats() { return [...this._chats] }
}

// ===== Records =====
const Records = {
  _currentTab: 'week',

  async show(tab) {
    this._currentTab = tab || this._currentTab
    document.querySelectorAll('.records-tab').forEach(t => t.classList.remove('active'))
    const el = document.querySelector(`[data-records-tab="${this._currentTab}"]`)
    if (el) el.classList.add('active')

    const sessions = await DB.getAllSessions()
    const stats = await DB.getStats(sessions)
    const s = stats[this._currentTab] || stats.all

    document.getElementById('records-count').textContent = s.total
    document.getElementById('records-time').textContent = this._fmtDur(s.totalTime)
    document.getElementById('records-count-label').textContent =
      this._currentTab === 'week' ? '本周完成' : this._currentTab === 'month' ? '本月完成' : '全部完成'

    // Filter
    const now = new Date()
    let filtered = [...sessions].sort((a, b) => b.date - a.date)
    if (this._currentTab === 'week') {
      const ws = new Date(now)
      ws.setDate(now.getDate() - ((now.getDay() + 6) % 7))
      ws.setHours(0,0,0,0)
      filtered = filtered.filter(s => s.date >= ws.getTime())
    } else if (this._currentTab === 'month') {
      const ms = new Date(now.getFullYear(), now.getMonth(), 1)
      filtered = filtered.filter(s => s.date >= ms.getTime())
    }

    const list = document.getElementById('records-list')
    if (!filtered.length) {
      list.innerHTML = '<div class="record-empty">还没有记录<br>开始一次专注吧</div>'
      return
    }
    list.innerHTML = filtered.map(s => {
      const d = new Date(s.date)
      const ds = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
      return `<div class="record-item" onclick="Records._view('${s.id}')">
        <div class="record-left">
          <div class="record-task">${this._esc(s.taskName)}</div>
          <div class="record-meta">${ds} · ${s.mode === 'countdown' ? '倒计时' : '正计时'}</div>
        </div>
        <div class="record-duration">${this._fmtDur(s.duration)}</div>
      </div>`
    }).join('')
  },

  _view(id) {
    DB.getAllSessions().then(sessions => {
      const s = sessions.find(x => x.id === id)
      if (!s) return
      Timer._showEndScreen(s)
      document.getElementById('end-save').dataset.result = ''
      document.getElementById('end-save').textContent = '返回列表'
    })
  },

  _fmtDur(secs) {
    if (!secs && secs !== 0) return '0分'
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    return h ? `${h}h${m}分` : `${m}分`
  },

  _esc(str) {
    const d = document.createElement('div')
    d.textContent = str
    return d.innerHTML
  }
}

// ===== App Init =====
document.addEventListener('DOMContentLoaded', () => {

  // --- Ringtone init ---
  Ringtone.init()

  // --- API Key Modal ---
  if (!KeyManager.has()) {
    document.getElementById('apikey-modal').classList.add('open')
  }

  document.getElementById('apikey-save')?.addEventListener('click', () => {
    const input = document.getElementById('apikey-input')
    const key = input.value.trim()
    if (key) KeyManager.set(key)
    document.getElementById('apikey-modal').classList.remove('open')
  })

  document.getElementById('apikey-skip')?.addEventListener('click', () => {
    document.getElementById('apikey-modal').classList.remove('open')
  })

  // --- Ringtone toggle (collapsible) ---
  const ringtonePanel = document.getElementById('ringtone-panel')
  const ringtoneArrow = document.getElementById('ringtone-arrow')
  document.getElementById('ringtone-toggle')?.addEventListener('click', () => {
    const open = ringtonePanel?.classList.toggle('open')
    if (ringtoneArrow) ringtoneArrow.classList.toggle('open', open)
  })

  // --- Ringtone upload ---
  const fileInput = document.getElementById('ringtone-file-input')
  document.getElementById('ringtone-upload-btn')?.addEventListener('click', () => fileInput?.click())
  fileInput?.addEventListener('change', e => {
    if (e.target.files?.[0]) Ringtone.handleFile(e.target.files[0])
    e.target.value = ''
  })

  // --- Ringtone test ---
  document.getElementById('ringtone-test-btn')?.addEventListener('click', () => Ringtone.preview())

  // --- Ringtone reset ---
  document.getElementById('ringtone-reset-btn')?.addEventListener('click', () => {
    if (confirm('重置为默认铃声？')) {
      Ringtone.reset()
    }
  })

  // --- Duration controls ---
  document.getElementById('duration-down')?.addEventListener('click', () => {
    const input = document.getElementById('duration-input')
    let val = Math.max(1, (parseInt(input.value) || 25) - 5)
    input.value = val
    document.getElementById('duration-display').textContent = String(val).padStart(2,'0')
  })
  document.getElementById('duration-up')?.addEventListener('click', () => {
    const input = document.getElementById('duration-input')
    let val = Math.min(480, (parseInt(input.value) || 25) + 5)
    input.value = val
    document.getElementById('duration-display').textContent = String(val).padStart(2,'0')
  })
  document.getElementById('duration-input')?.addEventListener('input', function() {
    const val = Math.max(1, Math.min(480, parseInt(this.value) || 25))
    this.value = val
    document.getElementById('duration-display').textContent = String(val).padStart(2,'0')
  })

  // --- Mode toggle ---
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'))
      this.classList.add('active')
    })
  })

  // --- Start ---
  document.getElementById('btn-start')?.addEventListener('click', () => {
    const taskName = document.getElementById('task-input').value.trim() || '专注'
    const duration = (parseInt(document.getElementById('duration-input').value) || 25) * 60
    const mode = document.querySelector('.mode-btn.active')?.dataset.mode || 'countdown'
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
    Timer.start(taskName, duration, mode)
    Nav.show('timer')
  })

  // --- Timer: tap to show exit ---
  const exitBtn = document.getElementById('timer-end')
  document.getElementById('timer-exit-area')?.addEventListener('click', () => {
    exitBtn?.classList.toggle('show')
    // Auto-hide after 3s
    if (exitBtn?.classList.contains('show')) {
      setTimeout(() => exitBtn.classList.remove('show'), 3000)
    }
  })

  // --- Timer: exit ---
  document.getElementById('timer-end')?.addEventListener('click', function(e) {
    e.stopPropagation()
    if (confirm('确定结束？')) {
      const result = Timer.stop()
      Timer._showEndScreen(result)
      document.getElementById('end-mode').textContent = '手动结束'
    }
  })

  // --- End: save ---
  document.getElementById('end-save')?.addEventListener('click', function() {
    const raw = this.dataset.result
    if (!raw) { Nav.show('records'); Records.show(); return }
    try {
      const session = JSON.parse(raw)
      DB.saveSession(session).then(() => {
        alert('已保存')
        Nav.show('home')
      })
    } catch(e) {
      alert('保存失败')
    }
  })

  // --- End: again ---
  document.getElementById('end-again')?.addEventListener('click', () => {
    Nav.show('home')
  })

  // --- Chat modal ---
  document.getElementById('chat-modal-close')?.addEventListener('click', () => {
    document.getElementById('chat-modal').classList.remove('open')
  })
  document.getElementById('chat-modal')?.addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('open')
  })

  // --- Chat send ---
  document.getElementById('chat-send')?.addEventListener('click', () => Bubbles._sendMessage(document.getElementById('chat-input')?.value || ''))
  document.getElementById('chat-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') Bubbles._sendMessage(e.target.value)
  })

  // --- Nav items ---
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', function() {
      const page = this.dataset.page
      if (page === 'timer') return
      Nav.show(page)
      if (page === 'records') Records.show()
    })
  })

  // --- Records tabs ---
  document.querySelectorAll('.records-tab').forEach(tab => {
    tab.addEventListener('click', function() {
      Records.show(this.dataset.recordsTab)
    })
  })

  // --- Orientation (removed forced landscape) ---
  // Timer works in both portrait and landscape.
  document.getElementById('rotate-close')?.addEventListener('click', () => {
    document.querySelector('.rotate-hint')?.classList.remove('show')
  })

  // --- Greeting ---
  const hour = new Date().getHours()
  const greet = hour < 6 ? '还没睡呀' : hour < 9 ? '早上好' : hour < 12 ? '上午好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'
  document.getElementById('home-greeting').textContent = greet

  const d = new Date()
  const wd = ['日','一','二','三','四','五','六']
  document.getElementById('home-date').textContent = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 星期${wd[d.getDay()]}`

  // --- Service Worker ---
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {})
  }

  console.log('专注伴伴已启动')
})
