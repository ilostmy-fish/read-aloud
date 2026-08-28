(() => {
  const api = browser
  const BLOCK_SELECTOR = "p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, pre, article, dd, dt, figcaption"
  const INTERACTIVE_SELECTOR = "a, button, input, textarea, select, option, label, summary, [role='button'], [role='link'], [contenteditable='true']"
  const IGNORE_SELECTOR = "script, style, svg, audio, video, dialog, embed, menu, nav, noframes, noscript, object, aside, footer, .no-read-aloud, [aria-hidden='true']"
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
  let pendingSelectionElement = null
  let pendingContextPoint = null
  let lastSpeechKey = null
  let lastGeneration = null
  let polling = false
  let pollTimer = null

  let sessionText = ""
  let sourceTokens = []
  let domTokens = []
  let sourceToDom = []
  let domToSource = []
  let domTokenLookup = new WeakMap()
  let mappingDirty = true
  let speechCache = []
  let speechCursor = 0
  let speechSignature = ""

  api.runtime.onMessage.addListener(request => {
    if (!request || request.method !== "firefoxReadAloudInitSession") return undefined
    const args = request.args || []
    initializeSession(String(args[0] || ""))
    return Promise.resolve({contextOrigin: resolveStoredContextOrigin()})
  })

  document.addEventListener("contextmenu", event => {
    pendingContextPoint = capturePoint(event.clientX, event.clientY, event.target)
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

    pendingSelectionElement = findSpecificReadableBlock(target) || findReadableBlock(target)
    if (pendingSelectionElement) {
      highlightedElement = pendingSelectionElement
      highlightedRange = null
      ensureHighlight()
      refreshHighlightRect()
    }

    send("pageSeek", anchor).catch(() => {})
  }, true)

  window.addEventListener("scroll", refreshHighlightRect, {passive: true})
  window.addEventListener("resize", refreshHighlightRect, {passive: true})

  const mutationObserver = new MutationObserver(mutations => {
    if (!sessionText) return
    for (const mutation of mutations) {
      const target = mutation.target && (mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement)
      if (target && ((host && host.contains(target)) || target === highlight)) continue
      mappingDirty = true
      break
    }
  })
  if (document.documentElement) mutationObserver.observe(document.documentElement, {childList: true, characterData: true, subtree: true})
  else document.addEventListener("readystatechange", () => {
    if (document.documentElement) mutationObserver.observe(document.documentElement, {childList: true, characterData: true, subtree: true})
  }, {once: true})

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

  function initializeSession(text) {
    sessionText = text
    sourceTokens = tokenizeString(sessionText)
    mappingDirty = true
    resetSpeechMapping()
    ensureAlignment()
  }

  function clearSessionMapping() {
    sessionText = ""
    sourceTokens = []
    domTokens = []
    sourceToDom = []
    domToSource = []
    domTokenLookup = new WeakMap()
    mappingDirty = true
    resetSpeechMapping()
  }

  function resetSpeechMapping() {
    speechCache = []
    speechCursor = 0
    speechSignature = ""
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
    if (!active && !host && !highlight) return
    active = false
    lastSpeechKey = null
    lastGeneration = null
    highlightedElement = null
    highlightedRange = null
    pendingSelectionElement = null
    if (host) host.remove()
    if (highlight) highlight.remove()
    host = shadow = playButton = stopButton = statusNode = highlight = null
    clearSessionMapping()
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

    const generation = Number(info.generation || 0)
    const currentIndex = Number(speech.position.index)
    const text = speech.texts[currentIndex]
    if (!text) {
      if (state !== "PAUSED") hideHighlight()
      return
    }

    ensureAlignment()
    const mapping = resolveSpeechChunk(info)
    if (!mapping) {
      if (state !== "PAUSED") hideHighlight()
      return
    }

    const boundaryMatches = boundary && boundary.text === text && boundary.charLength > 0
    const sentenceLevel = !boundaryMatches && (speech.engine === "Piper" || speech.engine === "Supertonic")
    const boundaryKey = boundaryMatches
      ? boundary.charIndex + ":" + boundary.charLength
      : sentenceLevel ? "sentence" : "chunk"
    const key = generation + ":" + currentIndex + ":" + boundaryKey
    if (key === lastSpeechKey && highlightedElement) {
      refreshHighlightRect()
      return
    }
    lastSpeechKey = key
    lastGeneration = generation

    let sourceIndex = null
    let range = null
    if (boundaryMatches) {
      const chunkTokenIndex = findTokenAtChar(mapping.chunkTokens, boundary.charIndex)
      sourceIndex = mappedTokenNear(mapping.chunkToSource, chunkTokenIndex)
      if (sourceIndex != null) range = rangeForSourceToken(sourceIndex)
    }
    else if (sentenceLevel) {
      const span = mappedSourceSpan(mapping.chunkToSource)
      if (span) {
        sourceIndex = span.start
        range = rangeForSourceSpan(span.start, span.end)
      }
    }

    if (sourceIndex == null) sourceIndex = firstMappedValue(mapping.chunkToSource)
    if (sourceIndex == null) {
      if (state !== "PAUSED") hideHighlight()
      return
    }

    const domIndex = nearestMappedDomIndex(sourceIndex)
    if (domIndex == null || !domTokens[domIndex]) {
      if (state !== "PAUSED") hideHighlight()
      return
    }

    const domToken = domTokens[domIndex]
    const elem = findSpecificReadableBlock(domToken.node.parentElement) || findReadableBlock(domToken.node.parentElement)
    if (!elem) {
      if (state !== "PAUSED") hideHighlight()
      return
    }

    highlightedElement = elem
    highlightedRange = (boundaryMatches || sentenceLevel) && range ? range : null
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

  function resolveSpeechChunk(info) {
    if (!sourceTokens.length || !info.speech || !Array.isArray(info.speech.texts)) return null
    const generation = Number(info.generation || 0)
    const texts = info.speech.texts
    const signature = generation + ":" + texts.length + ":" + String(texts[0] || "").slice(0, 80)

    if (signature !== speechSignature) {
      speechSignature = signature
      speechCache = []
      speechCursor = sourceTokenIndexAtOrAfter(Number(info.sessionOffset || 0))
    }

    const target = Number(info.speech.position.index)
    if (!Number.isInteger(target) || target < 0 || target >= texts.length) return null

    while (speechCache.length <= target) {
      const index = speechCache.length
      const chunkTokens = tokenizeString(String(texts[index] || ""))
      const chunkToSource = alignChunkToSource(chunkTokens, speechCursor)
      const mapped = chunkToSource.filter(value => value != null)
      if (mapped.length) speechCursor = Math.max(speechCursor, mapped[mapped.length - 1] + 1)
      speechCache.push({chunkTokens, chunkToSource})
    }
    return speechCache[target]
  }

  function alignChunkToSource(chunkTokens, startIndex) {
    const out = new Array(chunkTokens.length).fill(null)
    if (!chunkTokens.length || !sourceTokens.length) return out
    const from = Math.max(0, Math.min(sourceTokens.length, startIndex || 0))
    const to = Math.min(sourceTokens.length, from + chunkTokens.length + 180)
    const sourceSlice = sourceTokens.slice(from, to)
    const aligned = alignTokenLists(chunkTokens, sourceSlice, 70)
    for (let i = 0; i < aligned.aToB.length; i++) {
      if (aligned.aToB[i] != null) out[i] = from + aligned.aToB[i]
    }
    return out
  }

  function sourceTokenIndexAtOrAfter(offset) {
    if (!sourceTokens.length) return 0
    let lo = 0
    let hi = sourceTokens.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sourceTokens[mid].end <= offset) lo = mid + 1
      else hi = mid
    }
    return Math.max(0, Math.min(sourceTokens.length - 1, lo))
  }

  function findTokenAtChar(tokens, charIndex) {
    if (!tokens.length) return 0
    for (let i = 0; i < tokens.length; i++) {
      if (charIndex >= tokens[i].start && charIndex < tokens[i].end) return i
      if (tokens[i].start >= charIndex) return i
    }
    return tokens.length - 1
  }

  function mappedTokenNear(mapping, index) {
    if (!mapping.length) return null
    const start = Math.max(0, Math.min(mapping.length - 1, index || 0))
    if (mapping[start] != null) return mapping[start]
    for (let distance = 1; distance < Math.min(mapping.length, 12); distance++) {
      const after = start + distance
      if (after < mapping.length && mapping[after] != null) return mapping[after]
      const before = start - distance
      if (before >= 0 && mapping[before] != null) return mapping[before]
    }
    return null
  }

  function firstMappedValue(mapping) {
    for (const value of mapping) if (value != null) return value
    return null
  }

  function mappedSourceSpan(mapping) {
    let start = null
    let end = null
    for (const value of mapping) {
      if (value == null) continue
      if (start == null) start = value
      end = value
    }
    return start == null ? null : {start, end}
  }

  function rangeForSourceSpan(startSourceIndex, endSourceIndex) {
    const startDomIndex = nearestMappedDomIndex(startSourceIndex)
    const endDomIndex = nearestMappedDomIndex(endSourceIndex)
    if (startDomIndex == null || endDomIndex == null || startDomIndex > endDomIndex) {
      return rangeForSourceToken(startSourceIndex)
    }

    const first = domTokens[startDomIndex]
    const last = domTokens[endDomIndex]
    if (!first || !last || !first.node || !last.node || !first.node.isConnected || !last.node.isConnected) return null

    try {
      const range = document.createRange()
      range.setStart(first.node, first.start)
      range.setEnd(last.node, last.end)
      return range
    }
    catch (err) {
      return null
    }
  }

  function rangeForSourceToken(sourceIndex) {
    const domIndex = nearestMappedDomIndex(sourceIndex)
    const token = domIndex != null ? domTokens[domIndex] : null
    if (!token || !token.node || !token.node.isConnected) return null
    try {
      const range = document.createRange()
      range.setStart(token.node, token.start)
      range.setEnd(token.node, token.end)
      return range
    }
    catch (err) {
      return null
    }
  }

  function nearestMappedDomIndex(sourceIndex) {
    if (!sourceToDom.length) return null
    const start = Math.max(0, Math.min(sourceToDom.length - 1, sourceIndex))
    if (sourceToDom[start] != null) return sourceToDom[start]
    for (let distance = 1; distance < Math.min(sourceToDom.length, 40); distance++) {
      const after = start + distance
      if (after < sourceToDom.length && sourceToDom[after] != null) return sourceToDom[after]
      const before = start - distance
      if (before >= 0 && sourceToDom[before] != null) return sourceToDom[before]
    }
    return null
  }

  function ensureAlignment() {
    if (!sessionText || !sourceTokens.length || !mappingDirty) return
    domTokens = collectDomTokens()
    const aligned = alignTokenLists(sourceTokens, domTokens, 90)
    sourceToDom = aligned.aToB
    domToSource = aligned.bToA
    buildDomTokenLookup()
    mappingDirty = false
  }

  function alignTokenLists(a, b, windowSize) {
    const aToB = new Array(a.length).fill(null)
    const bToA = new Array(b.length).fill(null)
    let i = 0
    let j = 0

    while (i < a.length && j < b.length) {
      if (a[i].key === b[j].key) {
        aToB[i] = j
        bToA[j] = i
        i++
        j++
        continue
      }

      const sync = findSync(a, i, b, j, windowSize)
      if (sync) {
        i += sync.aSkip
        j += sync.bSkip
        continue
      }

      const aAhead = findKeyAhead(b, j + 1, Math.min(b.length, j + 14), a[i].key)
      const bAhead = findKeyAhead(a, i + 1, Math.min(a.length, i + 14), b[j].key)
      if (aAhead != null && (bAhead == null || aAhead - j <= bAhead - i)) j++
      else if (bAhead != null) i++
      else {
        i++
        j++
      }
    }

    return {aToB, bToA}
  }

  function findSync(a, ai, b, bi, windowSize) {
    const maxA = Math.min(a.length - ai, windowSize)
    const maxB = Math.min(b.length - bi, windowSize)
    let best = null

    for (let aSkip = 0; aSkip < maxA; aSkip++) {
      const key = a[ai + aSkip].key
      if (!key) continue
      for (let bSkip = 0; bSkip < maxB; bSkip++) {
        if (key !== b[bi + bSkip].key) continue
        let run = 0
        while (run < 8 && ai + aSkip + run < a.length && bi + bSkip + run < b.length && a[ai + aSkip + run].key === b[bi + bSkip + run].key) run++
        const distance = aSkip + bSkip
        const acceptable = run >= 3 || (run >= 2 && key.length >= 5) || (run === 1 && key.length >= 10 && distance <= 6)
        if (!acceptable) continue
        const rank = distance * 100 + Math.abs(aSkip - bSkip) * 5 - run * 12 - Math.min(key.length, 20)
        if (!best || rank < best.rank) best = {aSkip, bSkip, rank}
      }
    }
    return best
  }

  function findKeyAhead(tokens, from, to, key) {
    for (let i = from; i < to; i++) if (tokens[i].key === key) return i
    return null
  }

  function collectDomTokens() {
    const out = []
    const roots = getReadableRoots()
    const seenNodes = new Set()

    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node
      while ((node = walker.nextNode())) {
        if (seenNodes.has(node) || !isReadableTextNode(node)) continue
        seenNodes.add(node)
        const value = node.nodeValue || ""
        const tokens = tokenizeString(value)
        for (const token of tokens) out.push({key: token.key, node, start: token.start, end: token.end})
      }
    }
    return out
  }

  function getReadableRoots() {
    const marked = Array.from(document.querySelectorAll(".read-aloud"))
      .filter(elem => elem !== host && isVisible(elem) && normalize(elem.innerText || ""))
    if (marked.length) {
      return marked.filter(elem => !marked.some(other => other !== elem && other.contains(elem)))
    }

    const raw = Array.from(document.querySelectorAll(BLOCK_SELECTOR))
      .filter(elem => elem !== host && isVisible(elem) && normalize(elem.innerText || ""))
    const leafish = raw.filter(elem => !raw.some(other => other !== elem && elem.contains(other)))
    return leafish.length ? leafish : raw
  }

  function isReadableTextNode(node) {
    const parent = node.parentElement
    if (!parent || !node.nodeValue || !node.nodeValue.trim()) return false
    if (host && host.contains(parent)) return false
    if (parent.closest(IGNORE_SELECTOR)) return false
    for (let elem = parent; elem && elem !== document.documentElement; elem = elem.parentElement) {
      const style = getComputedStyle(elem)
      if (style.display === "none" || style.visibility === "hidden") return false
      if (style.position === "fixed" || style.cssFloat === "right") return false
      if (elem.classList && elem.classList.contains("read-aloud")) break
    }
    return true
  }

  function buildDomTokenLookup() {
    domTokenLookup = new WeakMap()
    for (let i = 0; i < domTokens.length; i++) {
      const token = domTokens[i]
      let list = domTokenLookup.get(token.node)
      if (!list) {
        list = []
        domTokenLookup.set(token.node, list)
      }
      list.push(i)
    }
  }

  function tokenizeString(text) {
    const tokens = []
    const value = String(text || "")
    let re
    try {
      re = new RegExp("[\\p{L}\\p{N}]+(?:['’][\\p{L}\\p{N}]+)*", "gu")
    }
    catch (err) {
      re = /[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g
    }
    let match
    while ((match = re.exec(value))) {
      tokens.push({key: match[0].toLocaleLowerCase(), start: match.index, end: match.index + match[0].length})
    }
    return tokens
  }

  function capturePoint(x, y, target) {
    const caret = getCaretAtPoint(x, y)
    const elem = target && target.nodeType === Node.ELEMENT_NODE ? target : target && target.parentElement
    return {
      node: caret && caret.node,
      offset: caret ? caret.offset : 0,
      elem: elem || document.elementFromPoint(x, y)
    }
  }

  function resolveStoredContextOrigin() {
    if (!pendingContextPoint || !pendingContextPoint.elem || !pendingContextPoint.elem.isConnected) return null
    ensureAlignment()
    return getAnchorFromPointData(pendingContextPoint, true)
  }

  function getAnchorAtPoint(x, y, sectionStart) {
    const point = capturePoint(x, y, document.elementFromPoint(x, y))
    return getAnchorFromPointData(point, sectionStart)
  }

  function getAnchorFromPointData(point, sectionStart) {
    let elem = point.elem
    if (!elem && point.node) elem = point.node.nodeType === Node.ELEMENT_NODE ? point.node : point.node.parentElement
    if (!elem) return null

    const block = findSpecificReadableBlock(elem) || findReadableBlock(elem)
    if (!block) return null
    const blockText = normalize(block.innerText || "")
    if (!blockText) return null

    ensureAlignment()
    let domIndex = null
    if (sectionStart) domIndex = firstMappedDomTokenInBlock(block)
    else domIndex = domTokenAtPointData(point, block)
    const sourceIndex = domIndex != null ? nearestMappedSourceIndex(domIndex) : null
    const sourceOffset = sourceIndex != null && sourceTokens[sourceIndex] ? sourceTokens[sourceIndex].start : null

    let approx = 0
    if (!sectionStart && point.node && block.contains(point.node)) {
      try {
        const range = document.createRange()
        range.selectNodeContents(block)
        range.setEnd(point.node, point.offset)
        approx = normalize(range.toString()).length
      }
      catch (err) {}
    }

    let start = sectionStart ? 0 : Math.min(Math.max(0, approx), blockText.length)
    while (start > 0 && !/\s/.test(blockText[start - 1])) start--
    const blocks = getDisplayBlocks()
    const blockIndex = blocks.indexOf(block)
    const previousText = blockIndex > 0 ? normalize(blocks[blockIndex - 1].innerText || "") : ""

    return {
      before: sectionStart ? previousText.slice(Math.max(0, previousText.length - 120)) : blockText.slice(Math.max(0, start - 120), start),
      after: blockText.slice(sectionStart ? 0 : start, Math.min(blockText.length, (sectionStart ? 0 : start) + 240)),
      sectionStart: !!sectionStart,
      blockIndex,
      blockCount: blocks.length,
      progress: sourceOffset != null && sessionText.length ? sourceOffset / sessionText.length : getBlockProgress(block, blocks, blockIndex, start, blockText.length),
      sourceOffset,
      sourceTokenIndex: sourceIndex
    }
  }

  function domTokenAtPointData(point, block) {
    if (point.node && point.node.nodeType === Node.TEXT_NODE) {
      const indices = domTokenLookup.get(point.node) || []
      if (indices.length) {
        let best = indices[0]
        let bestDistance = Infinity
        for (const index of indices) {
          const token = domTokens[index]
          let distance = 0
          if (point.offset < token.start) distance = token.start - point.offset
          else if (point.offset > token.end) distance = point.offset - token.end
          if (distance < bestDistance) {
            best = index
            bestDistance = distance
          }
        }
        return best
      }
    }
    return firstMappedDomTokenInBlock(block)
  }

  function firstMappedDomTokenInBlock(block) {
    for (let i = 0; i < domTokens.length; i++) {
      const token = domTokens[i]
      if (token.node && block.contains(token.node) && domToSource[i] != null) return i
    }
    return null
  }

  function nearestMappedSourceIndex(domIndex) {
    if (!domToSource.length) return null
    const start = Math.max(0, Math.min(domToSource.length - 1, domIndex))
    if (domToSource[start] != null) return domToSource[start]
    for (let distance = 1; distance < Math.min(domToSource.length, 40); distance++) {
      const after = start + distance
      if (after < domToSource.length && domToSource[after] != null) return domToSource[after]
      const before = start - distance
      if (before >= 0 && domToSource[before] != null) return domToSource[before]
    }
    return null
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

  function getDisplayBlocks() {
    const raw = Array.from(document.querySelectorAll(BLOCK_SELECTOR))
      .filter(elem => elem !== host && isVisible(elem) && normalize(elem.innerText || ""))
    const leafish = raw.filter(elem => !raw.some(other => other !== elem && elem.contains(other)))
    if (leafish.length) return leafish
    const marked = Array.from(document.querySelectorAll(".read-aloud"))
      .filter(elem => elem !== host && isVisible(elem) && normalize(elem.innerText || ""))
    return marked.length ? marked : raw
  }

  function getBlockProgress(block, blocks, blockIndex, offset, blockLength) {
    if (blockIndex >= 0 && blocks.length) {
      let total = 0
      let before = 0
      for (let i = 0; i < blocks.length; i++) {
        const length = normalize(blocks[i].innerText || "").length + 2
        if (i < blockIndex) before += length
        total += length
      }
      if (total > 0) return Math.max(0, Math.min(1, (before + Math.max(0, Math.min(offset || 0, blockLength || 0))) / total))
    }
    const rect = block.getBoundingClientRect()
    const absoluteTop = window.scrollY + rect.top
    const height = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, 1)
    return Math.max(0, Math.min(1, absoluteTop / height))
  }

  function findSpecificReadableBlock(elem) {
    if (!elem) return null
    let block = elem.closest && elem.closest(BLOCK_SELECTOR)
    if (!block || !isVisible(block) || !normalize(block.innerText || "")) return null
    const children = Array.from(block.querySelectorAll(BLOCK_SELECTOR))
      .filter(child => child !== block && isVisible(child) && normalize(child.innerText || ""))
    const containing = children.find(child => child.contains(elem))
    return containing || block
  }

  function findReadableBlock(elem) {
    if (!elem) return null
    const marked = elem.closest && elem.closest(".read-aloud")
    if (marked && isVisible(marked) && normalize(marked.innerText || "")) return marked
    const specific = findSpecificReadableBlock(elem)
    if (specific) return specific
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
