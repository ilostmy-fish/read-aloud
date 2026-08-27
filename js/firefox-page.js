(() => {
  const api = browser
  const BLOCK_SELECTOR = "p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, pre, article, dd, dt, figcaption"
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
  let highlightedBlockIndex = -1
  let pendingSelectionElement = null
  let lastSpeechKey = null
  let lastGeneration = null
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

    pendingSelectionElement = findReadableBlock(target)
    if (pendingSelectionElement) {
      highlightedElement = pendingSelectionElement
      highlightedRange = null
      const blocks = getMappingBlocks()
      highlightedBlockIndex = blocks.indexOf(pendingSelectionElement)
      ensureHighlight()
      refreshHighlightRect()
    }

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
      updateHighlight(info)
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
    ensureHighlight()
  }

  function ensureHighlight() {
    if (highlight && highlight.isConnected) return
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
    lastGeneration = null
    highlightedElement = null
    highlightedRange = null
    highlightedBlockIndex = -1
    pendingSelectionElement = null
    if (host) host.remove()
    if (highlight) highlight.remove()
    host = shadow = playButton = stopButton = statusNode = highlight = null
  }

  function updateHighlight(info) {
    const speech = info && info.speech
    const state = info && info.state
    const boundary = info && info.boundary

    if (!speech || !speech.texts || !speech.position || speech.position.index == null) {
      if (state === "PAUSED" && pendingSelectionElement && pendingSelectionElement.isConnected) {
        highlightedElement = pendingSelectionElement
        highlightedRange = null
        ensureHighlight()
        refreshHighlightRect()
      }
      else if (state !== "PAUSED") {
        hideHighlight()
      }
      return
    }

    const text = speech.texts[speech.position.index]
    if (!text) {
      hideHighlight()
      return
    }

    const generationChanged = info.generation != null && info.generation !== lastGeneration
    if (generationChanged) {
      lastGeneration = info.generation
      highlightedBlockIndex = -1
      lastSpeechKey = null
    }

    const boundaryMatches = boundary && boundary.text === text && boundary.charLength > 0
    const boundaryKey = boundaryMatches ? boundary.charIndex + ":" + boundary.charLength : "chunk"
    const key = String(info.generation || 0) + ":" + speech.position.index + ":" + boundaryKey + ":" + text.slice(0, 160)
    if (key === lastSpeechKey && highlightedElement) {
      refreshHighlightRect()
      return
    }
    lastSpeechKey = key

    const blocks = getMappingBlocks()
    const elem = findBestReadableElement(text, blocks, generationChanged ? info.sessionProgress : null)
    if (!elem) {
      if (state !== "PAUSED") hideHighlight()
      return
    }

    highlightedElement = elem
    highlightedBlockIndex = blocks.indexOf(elem)
    highlightedRange = boundaryMatches ? findBoundaryRange(elem, boundary) : null
    pendingSelectionElement = null
    ensureHighlight()
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
    highlight.style.width = Math.max(0, Math.min(window.innerWidth - left, rect.width + 6)) + "px"
    highlight.style.height = (rect.height + 4) + "px"
  }

  function findBoundaryRange(elem, boundary) {
    const word = normalize(boundary.text.slice(boundary.charIndex, boundary.charIndex + boundary.charLength)).toLocaleLowerCase()
    if (!word) return null

    const index = makeDomTextIndex(elem)
    if (!index.text || !index.positions.length) return null

    const chunk = normalize(boundary.text).toLocaleLowerCase()
    const prefix = normalize(boundary.text.slice(0, boundary.charIndex)).toLocaleLowerCase()
    let start = chunk ? index.text.indexOf(chunk) : -1
    if (start >= 0) start += prefix.length
    else start = index.text.indexOf(word)
    if (start < 0) return null

    while (start < index.text.length && index.text[start] === " ") start++
    const end = Math.min(index.positions.length - 1, start + word.length - 1)
    const first = index.positions[start]
    const last = index.positions[end]
    if (!first || !last) return null

    try {
      const range = document.createRange()
      range.setStart(first.node, first.offset)
      range.setEnd(last.node, last.offset + 1)
      return range
    }
    catch (err) {
      return null
    }
  }

  function makeDomTextIndex(elem) {
    let text = ""
    const positions = []
    let lastWasSpace = false
    const walker = document.createTreeWalker(elem, NodeFilter.SHOW_TEXT)
    let node

    while ((node = walker.nextNode())) {
      const source = node.nodeValue || ""
      for (let i = 0; i < source.length; i++) {
        const char = source[i]
        if (/\s/.test(char)) {
          if (text && !lastWasSpace) {
            text += " "
            positions.push({node, offset: i})
            lastWasSpace = true
          }
        }
        else {
          text += char.toLocaleLowerCase()
          positions.push({node, offset: i})
          lastWasSpace = false
        }
      }
    }

    if (text.endsWith(" ")) {
      text = text.slice(0, -1)
      positions.pop()
    }
    return {text, positions}
  }

  function findBestReadableElement(spokenText, blocks, restartProgress) {
    const spoken = normalize(spokenText).toLocaleLowerCase()
    if (!spoken || !blocks.length) return null

    const expectedIndex = restartProgress != null && Number.isFinite(Number(restartProgress))
      ? Math.round(Math.max(0, Math.min(1, Number(restartProgress))) * Math.max(0, blocks.length - 1))
      : highlightedBlockIndex >= 0 ? highlightedBlockIndex : 0

    if (highlightedBlockIndex >= 0 && highlightedBlockIndex < blocks.length) {
      const currentText = normalize(blocks[highlightedBlockIndex].innerText || "").toLocaleLowerCase()
      if (matchStrength(currentText, spoken) > 0) return blocks[highlightedBlockIndex]
    }

    let best = null
    let bestScore = -Infinity
    for (let i = 0; i < blocks.length; i++) {
      const elem = blocks[i]
      const text = normalize(elem.innerText || "").toLocaleLowerCase()
      if (!text) continue
      const strength = matchStrength(text, spoken)
      if (!strength) continue

      const distance = Math.abs(i - expectedIndex)
      const backwardPenalty = restartProgress == null && highlightedBlockIndex >= 0 && i < highlightedBlockIndex
        ? (highlightedBlockIndex - i) * 80
        : 0
      const score = strength * 1000 - distance * 12 - backwardPenalty
      if (score > bestScore) {
        best = elem
        bestScore = score
      }
    }
    return best
  }

  function matchStrength(blockText, spoken) {
    if (!blockText || !spoken) return 0
    if (blockText === spoken) return spoken.length + 500
    if (blockText.includes(spoken)) return spoken.length + 300
    if (spoken.includes(blockText) && blockText.length >= 8) return blockText.length + 180

    const anchors = makeSearchAnchors(spoken)
    let best = 0
    for (const anchor of anchors) {
      if (anchor && blockText.includes(anchor)) best = Math.max(best, anchor.length)
    }
    return best
  }

  function makeSearchAnchors(text) {
    const words = text.split(" ").filter(Boolean)
    const anchors = []
    if (text.length <= 160) anchors.push(text)
    if (words.length) anchors.push(words.slice(0, 14).join(" ").slice(0, 180))
    if (words.length > 5) anchors.push(words.slice(3, 17).join(" ").slice(0, 180))
    if (text.length >= 24) anchors.push(text.slice(0, 120))
    if (text.length < 24) anchors.push(text)
    return Array.from(new Set(anchors.filter(Boolean)))
  }

  function getAnchorAtPoint(x, y, sectionStart) {
    const caret = getCaretAtPoint(x, y)
    let node = caret && caret.node
    let offset = caret ? caret.offset : 0
    let elem = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)
    if (!elem) elem = document.elementFromPoint(x, y)
    if (!elem) return null

    const block = findReadableBlock(elem)
    if (!block) return null
    const blockText = normalize(block.innerText || "")
    if (!blockText) return null

    const blocks = getMappingBlocks()
    const blockIndex = blocks.indexOf(block)
    const blockCount = blocks.length
    const progress = getBlockProgress(block, blocks, blockIndex)

    if (sectionStart) {
      const previousText = blockIndex > 0 ? normalize(blocks[blockIndex - 1].innerText || "") : ""
      return {
        before: previousText.slice(Math.max(0, previousText.length - 120)),
        after: blockText.slice(0, 240),
        sectionStart: true,
        blockIndex,
        blockCount,
        progress
      }
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
    const before = blockText.slice(Math.max(0, start - 120), start)
    const after = blockText.slice(start, Math.min(blockText.length, start + 240))
    return {
      before,
      after,
      sectionStart: false,
      blockIndex,
      blockCount,
      progress: refineProgressWithinBlock(progress, block, blocks, blockIndex, start, blockText.length)
    }
  }

  function getCaretAtPoint(x, y) {
    if (document.caretPositionFromPoint) {
      const caret = document.caretPositionFromPoint(x, y)
      if (caret) return {node: caret.offsetNode, offset: caret.offset}
    }
    if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(x, y)
      if (range) return {node: range.startContainer, offset: range.startOffset}
    }
    return null
  }

  function getMappingBlocks() {
    const marked = Array.from(document.querySelectorAll(".read-aloud"))
      .filter(elem => elem !== host && isVisible(elem) && normalize(elem.innerText || ""))
    if (marked.length) return marked

    const raw = Array.from(document.querySelectorAll(BLOCK_SELECTOR))
      .filter(elem => elem !== host && isVisible(elem) && normalize(elem.innerText || ""))

    const leafish = raw.filter(elem => !raw.some(other => other !== elem && elem.contains(other)))
    return leafish.length ? leafish : raw
  }

  function getBlockProgress(block, blocks, blockIndex) {
    if (blockIndex >= 0 && blocks.length) {
      let total = 0
      let before = 0
      for (let i = 0; i < blocks.length; i++) {
        const length = normalize(blocks[i].innerText || "").length + 2
        if (i < blockIndex) before += length
        total += length
      }
      if (total > 0) return Math.max(0, Math.min(1, before / total))
    }

    const rect = block.getBoundingClientRect()
    const absoluteTop = window.scrollY + rect.top
    const height = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, 1)
    return Math.max(0, Math.min(1, absoluteTop / height))
  }

  function refineProgressWithinBlock(baseProgress, block, blocks, blockIndex, offset, blockLength) {
    if (blockIndex < 0 || !blocks.length || !blockLength) return baseProgress
    let total = 0
    let before = 0
    for (let i = 0; i < blocks.length; i++) {
      const length = normalize(blocks[i].innerText || "").length + 2
      if (i < blockIndex) before += length
      total += length
    }
    if (!total) return baseProgress
    return Math.max(0, Math.min(1, (before + Math.max(0, Math.min(offset, blockLength))) / total))
  }

  function findReadableBlock(elem) {
    if (!elem) return null

    const marked = elem.closest && elem.closest(".read-aloud")
    if (marked && isVisible(marked) && normalize(marked.innerText || "")) return marked

    let block = elem.closest && elem.closest(BLOCK_SELECTOR)
    if (block && isVisible(block) && normalize(block.innerText || "")) {
      const children = Array.from(block.querySelectorAll(BLOCK_SELECTOR))
        .filter(child => child !== block && isVisible(child) && normalize(child.innerText || ""))
      if (children.length) {
        const containing = children.find(child => child.contains(elem))
        if (containing) block = containing
      }
      return block
    }

    for (let current = elem; current && current !== document.documentElement; current = current.parentElement) {
      const text = normalize(current.innerText || "")
      if (text.length >= 20 && isVisible(current)) return current
    }
    return null
  }

  function isVisible(elem) {
    if (!elem || !elem.isConnected) return false
    const style = getComputedStyle(elem)
    if (style.display === "none" || style.visibility === "hidden") return false
    const rect = elem.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  function normalize(text) {
    return String(text || "").replace(/\s+/g, " ").trim()
  }
})()
