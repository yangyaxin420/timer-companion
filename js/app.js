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

  start() {
    this._chats = []
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
        text,
        time: new Date().toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'})
      })
      this._showBubble(text)
    }
  },

  async _fetchAI() {
    const msg = this._buildPrompt()
    const result = await API.chat([
      { role: 'system', content: '用简短自然的话（20字以内）鼓励正在专注的用户。每次说的内容不要重复。不要说标点。' },
      { role: 'user', content: msg }
    ])
    if (result) return result

    // Fallback messages
    const messages = [
      '慢慢来 比较快',
      '你已经在路上了',
      '专注本身就是收获',
      '每一步都算数',
      '今天的你也很棒',
      '认真的人闪闪发光',
      '坚持一下 快要到了',
      '你已经做得很好了',
      '享受这个过程吧',
      '专注的你很漂亮',
      '加油 我在陪着你',
      '不急 慢慢来',
      '你比想象中更强大',
      '又是一次进步呢'
    ]
    const used = this._chats.slice(-3).map(c => c.text)
    const avail = messages.filter(m => !used.includes(m))
    return (avail.length ? avail : messages)[Math.floor(Math.random() * (avail.length || messages.length))]
  },

  _buildPrompt() {
    const elapsed = Timer.state.elapsed
    const minutes = Math.floor(elapsed / 60)
    const totalMin = Math.floor(Timer.state.duration / 60)
    return `任务「${Timer.state.taskName}」已进行 ${minutes} 分钟（共 ${totalMin} 分钟）。请用一句话鼓励。`
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
    setTimeout(() => bubble.remove(), 10500)
  },

  _showChatModal() {
    const modal = document.getElementById('chat-modal')
    const body = modal.querySelector('.modal-body')
    body.innerHTML = this._chats.map(c =>
      `<div class="chat-msg ai">${c.text}<div class="chat-msg-time" style="font-size:11px;color:var(--text-light);margin-top:4px;">${c.time}</div></div>`
    ).join('') || '<div style="color:var(--text-light);text-align:center;">暂无消息</div>'
    modal.classList.add('open')
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
