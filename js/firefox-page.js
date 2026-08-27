(() => {
  const api = browser
  const BLOCK_SELECTOR = "p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, pre, article"
  const INTERACTIVE_SELECTOR = "a, button, input, textarea, select, option, label, summary, [role='button'], [role='link'], [contenteditable='true']"
  const ACTIVE_POLL_INTERVAL = 180
  const INACTIVE_POLL_INTERVAL = 900

  let active = false
  let host = null
  let shadow = null
  let playButton = null
  let stopButton = null
  let statusNode = null
  let highlight = null
  let highlightedElement = null
  let highlightedRange = null
  let lastSpeechKey = null
  let polling = false
  let pollTimer = null

  document.addEventListener("contextmenu", event => {
    const origin = getAnchorAtPoint(event.clientX, event.clientY, true)
    if (origin && origin.after) send("pageContextOrigin", origin).catch(() => {})
  }, true)

  document.addEventListener("click", event => {
    if (!active || event.button !== 0) return
    if (host && event.composedPath().includes(host)) return
    const target = event.target && event.target.nodeType === Node.ELEMENT_NODE ? event.target : event.target.parentElement
    if (!target || target.closest(INTERACTIVE_SELECTOR)) return

    const anchor = getAnchorAtPoint(event.clientX, event.clientY, false)
    if (!anchor || !anchor.after) return

    event.preventDefault()
    event.stopPropagation()
    send("pageSeek", anchor).catch(() => {})
  }, true)

  window.addEventListener("scroll", refreshHighlightRect, {passive: true})
  window.addEventListener("resize", refreshHighlightRect, {passive: true})

  schedulePoll(0)

  function schedulePoll(delay) {
    if (pollTimer) clearTimeout(pollTimer)
    pollTimer = setTimeout(poll, delay)
  }

  async function poll() {
    if (polling) return
    polling = true
    try {
      const info = await send("getPagePlaybackState")
      if (!info || !info.active) {
        setInactive()
        return
      }

      active = true
      ensureController()
      updateController(info.state)
      updateHighlight(info.speech, info.state, info.boundary)
    }
    catch (err) {
      setInactive()
    }
    finally {
      polling = false
      schedulePoll(active ? ACTIVE_POLL_INTERVAL : INACTIVE_POLL_INTERVAL)
    }
  }

  function send(method, ...args) {
    return api.runtime.sendMessage({method, args})
      .then(result => {
        if (result && result.error) throw new Error(result.error)
        return result
      })
  }

  function ensureController() {
    if (host && host.isConnected) return

    host = document.createElement("div")
    host.id = "read-aloud-firefox-controller"
    host.style.all = "initial"
    host.style.position = "fixed"
    host.style.left = "50%"
    host.style.top = "14px"
    host.style.transform = "translateX(-50%)"
    host.style.zIndex = "2147483647"
    host.style.pointerEvents = "auto"

    shadow = host.attachShadow({mode: "closed"})
    const style = document.createElement("style")
    style.textContent = `
      :host { all: initial; }
      .panel {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 9px;
        border: 1px solid rgba(0, 0, 0, .28);
        border-radius: 10px;
        background: rgba(32, 32, 32, .96);
        color: white;
        box-shadow: 0 3px 14px rgba(0, 0, 0, .28);
        font: 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      button {
        width: 34px;
        height: 30px;
        border: 0;
        border-radius: 7px;
        background: rgba(255, 255, 255, .12);
        color: white;
        cursor: pointer;
        font: 16px/30px -apple-system, BlinkMacSystemFont, "Segoe UI Symbol", sans-serif;
        padding: 0;
      }
      button:hover { background: rgba(255, 255, 255, .22); }
      button:disabled { cursor: default; opacity: .55; }
      .status { min-width: 58px; text-align: center; user-select: none; }
    `

    const panel = document.createElement("div")
    panel.className = "panel"

    playButton = document.createElement("button")
    playButton.type = "button"
    playButton.title = "Pause"
    playButton.setAttribute("aria-label", "Pause read aloud")
    playButton.textContent = "❚❚"
    playButton.addEventListener("click", event => {
      event.preventDefault()
      event.stopPropagation()
      send("pageTogglePlayback").catch(() => {})
    })

    stopButton = document.createElement("button")
    stopButton.type = "button"
    stopButton.title = "Stop reading"
    stopButton.setAttribute("aria-label", "Stop read aloud")
    stopButton.textContent = "■"
    stopButton.addEventListener("click", event => {
      event.preventDefault()
      event.stopPropagation()
      send("pageStop").catch(() => {})
    })

    statusNode = document.createElement("span")
    statusNode.className = "status"
    statusNode.textContent = "Reading"

    panel.append(playButton, stopButton, statusNode)
    shadow.append(style, panel)
    document.documentElement.appendChild(host)

    highlight = document.createElement("div")
    highlight.id = "read-aloud-firefox-highlight"
    Object.assign(highlight.style, {
      position: "fixed",
      display: "none",
      pointerEvents: "none",
      zIndex: "2147483646",
      borderRadius: "4px",
      background: "rgba(255, 213, 79, .28)",
      boxShadow: "0 0 0 2px rgba(255, 193, 7, .58) inset",
      transition: "top .10s ease, left .10s ease, width .10s ease, height .10s ease"
    })
    document.documentElement.appendChild(highlight)
  }

  function updateController(state) {
    if (!playButton || !statusNode) return
    if (state === "PLAYING") {
      playButton.disabled = false
      playButton.textContent = "❚❚"
      playButton.title = "Pause"
      playButton.setAttribute("aria-label", "Pause read aloud")
      statusNode.textContent = "Reading"
    }
    else if (state === "PAUSED") {
      playButton.disabled = false
      playButton.textContent = "▶"
      playButton.title = "Play"
      playButton.setAttribute("aria-label", "Resume read aloud")
      statusNode.textContent = "Paused"
    }
    else if (state === "LOADING") {
      playButton.disabled = true
      playButton.textContent = "…"
      statusNode.textContent = "Loading"
    }
    else {
      playButton.disabled = true
      playButton.textContent = "▶"
      statusNode.textContent = "Stopped"
    }
  }

  function setInactive() {
    active = false
    lastSpeechKey = null
    highlightedElement = null
    highlightedRange = null
    if (host) host.remove()
    if (highlight) highlight.remove()
    host = shadow = playButton = stopButton = statusNode = highlight = null
  }

  function updateHighlight(speech, state, boundary) {
    if (!speech || !speech.texts || !speech.position || speech.position.index == null) {
      hideHighlight()
      return
    }

    const text = speech.texts[speech.position.index]
    if (!text) {
      hideHighlight()
      return
    }

    const boundaryMatches = boundary && boundary.text === text && boundary.charLength > 0
    const boundaryKey = boundaryMatches ? boundary.charIndex + ":" + boundary.charLength : "chunk"
    const key = speech.position.index + ":" + boundaryKey + ":" + text.slice(0, 140)
    if (key === lastSpeechKey && highlightedElement) {
      refreshHighlightRect()
      return
    }
    lastSpeechKey = key

    const elem = findBestReadableElement(text)
    if (!elem) {
      hideHighlight()
      return
    }

    highlightedElement = elem
    highlightedRange = boundaryMatches ? findBoundaryRange(elem, boundary) : null

    if (state === "PLAYING") {
      const rect = getCurrentHighlightRect()
      if (rect && (rect.bottom < 80 || rect.top > window.innerHeight - 40)) {
        elem.scrollIntoView({block: "center", behavior: "smooth"})
      }
    }
    refreshHighlightRect()
  }

  function hideHighlight() {
    highlightedElement = null
    highlightedRange = null
    if (highlight) highlight.style.display = "none"
  }

  function getCurrentHighlightRect() {
    if (highlightedRange) {
      try {
        const rangeRect = highlightedRange.getBoundingClientRect()
        if (rangeRect.width && rangeRect.height) return rangeRect
      }
      catch (err) {}
    }
    if (highlightedElement && highlightedElement.isConnected) return highlightedElement.getBoundingClientRect()
    return null
  }

  function refreshHighlightRect() {
    if (!highlight || !highlightedElement || !highlightedElement.isConnected) return
    const rect = getCurrentHighlightRect()
    if (!rect || !rect.width || !rect.height || rect.bottom < 0 || rect.top > window.innerHeight) {
      highlight.style.display = "none"
      return
    }
    const left = Math.max(0, rect.left - 3)
    const top = Math.max(0, rect.top - 2)
    highlight.style.display = "block"
    highlight.style.left = left + "px"
    highlight.style.top = top + "px"
    highlight.style.width = Math.min(window.innerWidth - left, rect.width + 6) + "px"
    highlight.style.height = (rect.height + 4) + "px"
  }

  function findBoundaryRange(elem, boundary) {
    const word = boundary.text.slice(boundary.charIndex, boundary.charIndex + boundary.charLength).trim()
    if (!word) return null

    const needle = word.toLocaleLowerCase()
    const walker = document.createTreeWalker(elem, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      const source = node.nodeValue || ""
      const index = source.toLocaleLowerCase().indexOf(needle)
      if (index < 0) continue
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + word.length)
      return range
    }
    return null
  }

  function findBestReadableElement(spokenText) {
    const spoken = normalize(spokenText)
    if (!spoken) return null
    const anchors = makeSearchAnchors(spoken)
    const nodes = document.querySelectorAll(BLOCK_SELECTOR)
    let best = null
    let bestLength = Infinity

    for (const elem of nodes) {
      if (!isVisible(elem)) continue
      const text = normalize(elem.innerText || "")
      if (!text || text.length < 2) continue
      if (!anchors.some(anchor => anchor && (text.includes(anchor) || anchor.includes(text.slice(0, Math.min(text.length, 80)))))) continue
      if (text.length < bestLength) {
        best = elem
        bestLength = text.length
      }
    }
    return best
  }

  function makeSearchAnchors(text) {
    const words = text.split(" ").filter(Boolean)
    const anchors = []
    if (words.length) anchors.push(words.slice(0, 10).join(" ").slice(0, 120))
    if (words.length > 5) anchors.push(words.slice(3, 13).join(" ").slice(0, 120))
    anchors.push(text.slice(0, 56))
    return anchors.filter(anchor => anchor.length >= 12)
  }

  function getAnchorAtPoint(x, y, sectionStart) {
    const caret = document.caretPositionFromPoint ? document.caretPositionFromPoint(x, y) : null
    let node = caret && caret.offsetNode
    let offset = caret ? caret.offset : 0
    let elem = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)
    if (!elem) elem = document.elementFromPoint(x, y)
    if (!elem) return null

    const block = findReadableBlock(elem)
    if (!block) return null
    const blockText = normalize(block.innerText || "")
    if (!blockText) return null

    if (sectionStart) {
      return {before: "", after: blockText.slice(0, 180), sectionStart: true}
    }

    let approx = 0
    if (caret && node && block.contains(node)) {
      try {
        const range = document.createRange()
        range.selectNodeContents(block)
        range.setEnd(node, offset)
        approx = normalize(range.toString()).length
      }
      catch (err) {
        approx = 0
      }
    }

    let start = Math.min(Math.max(0, approx), blockText.length)
    while (start > 0 && !/\s/.test(blockText[start - 1])) start--
    const before = blockText.slice(Math.max(0, start - 90), start)
    const after = blockText.slice(start, Math.min(blockText.length, start + 190))
    return {before, after, sectionStart: false}
  }

  function findReadableBlock(elem) {
    let block = elem.closest && elem.closest(BLOCK_SELECTOR)
    if (block && isVisible(block) && normalize(block.innerText || "")) return block

    for (let current = elem; current && current !== document.documentElement; current = current.parentElement) {
      const text = normalize(current.innerText || "")
      if (text.length >= 20 && isVisible(current)) return current
    }
    return null
  }

  function isVisible(elem) {
    const style = getComputedStyle(elem)
    if (style.display === "none" || style.visibility === "hidden") return false
    const rect = elem.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  function normalize(text) {
    return String(text || "").replace(/\s+/g, " ").trim()
  }
})()
