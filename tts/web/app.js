// Jarvis — Real Time TTS · frontend
// Push-to-talk -> /voice/chat NDJSON sentence stream -> speak each sentence
// while the rest is still generating. Barge-in kills both stream and speech.
'use strict'

// ---------------------------------------------------------------- speech out

const Tts = {
  _audio: null,
  _queue: [],
  _speaking: false,

  // Spoken-sentence safety cap (mirror of the backend's): cut at the last
  // sentence boundary under 600 chars so a runaway reply never becomes a
  // ten-minute utterance.
  cap(text) {
    let s = String(text).trim()
    if (s.length <= 600) return s
    const cut = s.lastIndexOf('. ', 600)
    s = cut > 200 ? s.slice(0, cut + 1) : s.slice(0, 600)
    s = s.replace(/[ ,;:]+$/, '')
    if (!/[.!?]$/.test(s)) s += '.'
    return s
  },

  // Streaming GET: the Audio element starts playing as edge-tts chunks
  // arrive — first sound well under a second. There is deliberately NO
  // speechSynthesis fallback: this page is served by the same server that
  // synthesizes, so if /tts fails the whole app is down and a Microsoft
  // system voice blurting over the dead JARVIS voice is worse than silence.
  // One silent retry covers transient edge-tts hiccups; a second failure
  // surfaces as an inline [tts unavailable] note and the queue drains on.
  // A watchdog covers cold-start hangs that would otherwise wedge the queue
  // forever (readyState stuck at 0).
  async _speakAsync(clean, onEnd) {
    await this._attempt(clean, onEnd, 0)
  },

  async _attempt(clean, onEnd, attempt) {
    const done = () => { if (onEnd) { try { onEnd() } catch { /* ignore */ } } }
    const giveUp = () => {
      if (attempt === 0) this._attempt(clean, onEnd, 1)  // one silent retry
      else this._fail(done)
    }
    try {
      const audio = new Audio('/tts?text=' + encodeURIComponent(clean) + (attempt ? '&r=1' : ''))
      this._audio = audio
      audio.onended = done
      audio.onerror = () => { if (this._audio === audio) giveUp() }
      const watchdog = setTimeout(() => {
        if (this._audio === audio && !audio.buffered.length && audio.currentTime <= 0 && audio.readyState < 2) {
          giveUp()
        }
      }, 8000)
      audio.onplaying = () => clearTimeout(watchdog)
      await audio.play()
    } catch (err) {
      // stop() interrupting a pending play() rejects with AbortError AFTER
      // _audio was swapped — that is barge-in cleanup, not a failure.
      if (this._audio !== audio || (err && err.name === 'AbortError')) return
      giveUp()
    }
  },

  _fail(done) {
    noteError('tts unavailable — check the server')
    done()
  },

  // Sentence queue: events from /voice/chat are spoken back-to-back so the
  // first sentence plays while later ones are still being generated.
  enqueueSpeak(text) {
    const clean = String(text).trim()
    if (!clean) return
    this._queue.push(clean)
    this._pump()
  },

  _pump() {
    if (this._speaking || !this._queue.length) return
    const text = this._queue.shift()
    this._speaking = true
    setState('speaking')
    this._speakAsync(this.cap(text), () => {
      this._speaking = false
      if (this._queue.length) this._pump()
      else setState('idle')
    })
  },

  stop() {
    this._queue = []
    this._speaking = false
    try { window.speechSynthesis.cancel() } catch { /* ignore */ }
    if (this._audio) {
      try { this._audio.pause(); this._audio.removeAttribute('src') } catch { /* ignore */ }
      this._audio = null
    }
  },

  // Near-instant acknowledgement while the real reply streams (~100ms cached).
  ack(line) {
    try {
      const audio = new Audio('/tts?text=' + encodeURIComponent(line))
      this._audio = audio
      audio.play().catch(() => {})  // no ack → silence; never the system voice
    } catch { /* ignore */ }
  }
}

const ACK_LINES = ['Right away, sir', 'On it, sir', 'At once, sir', 'Working on it now, sir', 'Consider it done, sir']
let _ackI = 0

// ---------------------------------------------------------------- ui glue

const consoleEl = document.getElementById('console')
const stateEl = document.getElementById('state')
const micBtn = document.getElementById('micBtn')
const micHint = document.getElementById('micHint')
const typeForm = document.getElementById('typeForm')
const typeInput = document.getElementById('typeInput')
const stopBtn = document.getElementById('stopBtn')

function setState(s) {
  stateEl.className = 'pill ' + s
  stateEl.textContent = s
}

function addMsg(role, text) {
  const div = document.createElement('div')
  div.className = 'msg ' + role
  const who = document.createElement('div')
  who.className = 'who'
  who.textContent = role === 'you' ? 'you' : role === 'agent' ? 'agent' : 'jarvis'
  const t = document.createElement('div')
  t.className = 'text'
  t.textContent = text || ''
  div.append(who, t)
  consoleEl.append(div)
  consoleEl.scrollTop = consoleEl.scrollHeight
  return t
}

function updateLast(text) {
  const t = consoleEl.lastElementChild && consoleEl.lastElementChild.querySelector('.text')
  if (t) {
    t.textContent = text
    consoleEl.scrollTop = consoleEl.scrollHeight
  }
}

function noteError(text) {
  const div = document.createElement('div')
  div.className = 'msg err'
  div.textContent = '[' + text + ']'
  consoleEl.append(div)
  consoleEl.scrollTop = consoleEl.scrollHeight
}

// ---------------------------------------------------------------- stream in

let aborter = null

async function sendStream(text) {
  const query = (text || '').trim()
  if (!query) return
  Tts.stop()
  aborter = new AbortController()
  addMsg('you', query)
  setState('thinking')
  Tts.ack(ACK_LINES[_ackI++ % ACK_LINES.length])
  let agentCmd = null
  let agentResult = false
  let full = ''
  let added = false
  const upsert = t => {
    if (!added) { const t2 = addMsg('jarvis', t); added = true }
    else updateLast(full)
  }
  try {
    const res = await fetch('/voice/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: aborter.signal
    })
    if (!res.ok || !res.body) throw new Error('backend ' + res.status)
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let ev
        try { ev = JSON.parse(line) } catch { continue }
        if (ev.t === 's') {
          full += (full ? ' ' : '') + ev.text
          upsert(full)
          Tts.enqueueSpeak(ev.text)
        } else if (ev.t === 'agent') {
          agentCmd = ev.cmd
          addMsg('agent', '→ agent: ' + ev.cmd)
        } else if (ev.t === 'agent_result') {
          agentResult = true
          addMsg('agent', '→ hermes: ' + ev.text.slice(0, 600))
        } else if (ev.t === 'err') {
          updateLast(full ? full + '\n[error] ' + ev.msg : '[error] ' + ev.msg)
        }
      }
    }
    if (!added && !agentCmd) addMsg('jarvis', full || '(no reply)')
    if (agentResult && !full) setState('idle')  // summary turn failed to speak
  } catch (e) {
    const msg = (e && e.name === 'AbortError') ? '[stopped]' : '[error] ' + ((e && e.message) || 'voice chat failed')
    updateLast(msg)
    setState('idle')
    return
  } finally {
    aborter = null
    if (agentCmd && !agentResult) {
      Tts.stop()
      setState('idle')
      addMsg('jarvis', '→ action handed to host agent: ' + agentCmd)
    }
  }
}

// ---------------------------------------------------------------- mic in

const SR = window.SpeechRecognition || window.webkitSpeechRecognition
const micOk = !!SR

if (!micOk) {
  micBtn.disabled = true
  micHint.textContent = 'mic needs Chrome/Edge (Web Speech API) — typing works everywhere'
} else {
  micBtn.disabled = false
  micHint.textContent = 'hold SPACE or the mic button, talk, release to send'
}

let listening = false
let recog = null

function startListening() {
  if (listening || !micOk) return
  listening = true
  micBtn.classList.add('listening')
  micHint.classList.add('mic-holding')
  micHint.textContent = 'listening… release to send'
  recog = new SR()
  recog.interimResults = false
  recog.lang = 'en-US'
  recog.onresult = e => {
    const said = e.results[0][0].transcript
    listening = false
    micBtn.classList.remove('listening')
    micHint.classList.remove('mic-holding')
    micHint.textContent = 'hold SPACE or the mic button, talk, release to send'
    sendStream(said)
  }
  recog.onerror = recog.onend = () => {
    listening = false
    micBtn.classList.remove('listening')
    micHint.classList.remove('mic-holding')
    micHint.textContent = 'hold SPACE or the mic button, talk, release to send'
  }
  try { recog.start() } catch { listening = false }
}

function stopListening(cancel) {
  if (recog && cancel) { try { recog.abort() } catch { /* ignore */ } }
  listening = false
  micBtn.classList.remove('listening')
  micHint.classList.remove('mic-holding')
}

micBtn.addEventListener('mousedown', startListening)
micBtn.addEventListener('mouseup', () => stopListening(false))
micBtn.addEventListener('mouseleave', () => stopListening(false))

document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !e.repeat && document.activeElement !== typeInput && !listening) {
    e.preventDefault()
    startListening()
  }
  if (e.code === 'Escape') {
    stopListening(true)
    if (aborter) { try { aborter.abort() } catch { /* ignore */ } }
    Tts.stop()
    setState('idle')
  }
})
document.addEventListener('keyup', e => {
  if (e.code === 'Space' && listening) {
    e.preventDefault()
    stopListening(false) // recognition stops itself after results arrive
  }
})

typeForm.addEventListener('submit', e => {
  e.preventDefault()
  const q = typeInput.value
  typeInput.value = ''
  sendStream(q)
})

stopBtn.addEventListener('click', () => {
  if (aborter) { try { aborter.abort() } catch { /* ignore */ } }
  Tts.stop()
  setState('idle')
})

// Warm the TTS cache so the first ack is instant.
fetch('/tts?text=' + encodeURIComponent(ACK_LINES[0])).catch(() => {})
