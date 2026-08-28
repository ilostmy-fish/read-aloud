(() => {
  if (!isChatgptLocation()) return

  const api = browser
  const MESSAGE_SELECTOR = '[data-message-author-role="user"], [data-message-author-role="assistant"]'
  const TURN_SELECTOR = '[data-testid^="conversation-turn-"], [data-turn-id], article[data-turn], section[data-turn]'
  const BLOCK_SELECTOR = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, pre, dd, dt, figcaption'
  const INTERACTIVE_SELECTOR = 'a, button, input, textarea, select, option, label, summary, [role="button"], [role="link"], [contenteditable="true"]'
  const SKIP_TEXT_SELECTOR = 'button, textarea, input, select, option, script, style, svg, audio, video, [aria-hidden="true"]'
  const POLL_INTERVAL = 180

  const turnCache = new Map()
  let firstSeenSerial = 0
  let harvestTimer = null
  let sessionText = ''
  let sessionTurns = []
  let sessionTurnByKey = new Map()
  let sourceTokens = []
  let speechSignature = ''
  let speechCache = []
  let speechCursor = 0
  let active = false
  let pendingContextPoint = null
  let pendingSelectionBlock = null
  let highlight = null
  let genericHighlightStyle = null
  let pollTimer = null
  let polling = false
  const domMapCache = new Map()

  installGenericHighlightSuppressor()
  installObservers()
  harvestTurns()
  schedulePoll(0)

  api.runtime.onMessage.addListener(request => {
    if (!request) return undefined
    if (request.method === 'firefoxChatgptGetSnapshot') {
      harvestTurns()
      return Promise.resolve(buildSnapshot())
    }
    if (request.method === 'firefoxChatgptInitSession') {
      const args = request.args || []
      initializeSession(String(args[0] || ''), args[1] || null)
      return Promise.resolve({contextOrigin: resolveStoredContextOrigin()})
    }
    return undefined
  })

  document.addEventListener('contextmenu', event => {
    const message = findMessageElement(event.target)
    if (!message) return

    pendingContextPoint = capturePoint(event.clientX, event.clientY, event.target)
    harvestMessage(message)
    const anchor = getAnchorFromPoint(pendingContextPoint, true)
    if (anchor) {
      // firefox-page.js also records a generic context origin. Send this
      // turn-aware anchor after the current event dispatch so it wins without
      // interfering with ChatGPT's own context-menu listeners.
      setTimeout(() => send('pageContextOrigin', anchor).catch(() => {}), 0)
    }
  }, true)

  document.addEventListener('click', event => {
    if (!active || event.button !== 0) return
    if (isControllerEvent(event)) return

    const target = event.target && event.target.nodeType === Node.ELEMENT_NODE
      ? event.target
      : event.target && event.target.parentElement
    if (!target || target.closest(INTERACTIVE_SELECTOR)) return

    const message = findMessageElement(target)
    if (!message) return

    const point = capturePoint(event.clientX, event.clientY, target)
    harvestMessage(message)
    const anchor = getAnchorFromPoint(point, false)
    if (!anchor) return

    event.preventDefault()
    event.stopImmediatePropagation()

    pendingSelectionBlock = findReadableBlock(target, message) || message
    showElementHighlight(pendingSelectionBlock)
    send('pageSeek', anchor).catch(() => {})
  }, true)

  window.addEventListener('scroll', refreshHighlightRect, {passive: true})
  window.addEventListener('resize', refreshHighlightRect, {passive: true})

  function isChatgptLocation() {
    const host = location.hostname.toLowerCase()
    return host === 'chatgpt.com' || host === 'www.chatgpt.com' || host === 'chat.openai.com'
  }

  function installObservers() {
    const observer = new MutationObserver(() => {
      scheduleHarvest()
      domMapCache.clear()
    })
    const attach = () => {
      if (document.documentElement) {
        observer.observe(document.documentElement, {childList: true, characterData: true, subtree: true})
      }
    }
    if (document.documentElement) attach()
    else document.addEventListener('readystatechange', attach, {once: true})
  }

  function scheduleHarvest() {
    if (harvestTimer) return
    harvestTimer = setTimeout(() => {
      harvestTimer = null
      harvestTurns()
    }, 80)
  }

  function harvestTurns() {
    const messages = Array.from(document.querySelectorAll(MESSAGE_SELECTOR))
    for (const message of messages) harvestMessage(message)
  }

  function harvestMessage(message) {
    if (!message || !message.isConnected) return null
    const text = extractMessageText(message)
    if (!text) return null

    const identity = getTurnIdentity(message)
    if (!identity.key) return null

    const existing = turnCache.get(identity.key)
    const record = existing || {
      key: identity.key,
      role: identity.role,
      order: identity.order,
      virtualTop: identity.virtualTop,
      firstSeen: ++firstSeenSerial,
      text: ''
    }
    record.role = identity.role || record.role
    if (Number.isFinite(identity.order)) record.order = identity.order
    if (Number.isFinite(identity.virtualTop)) record.virtualTop = identity.virtualTop
    record.text = text
    turnCache.set(identity.key, record)
    return record
  }

  function buildSnapshot() {
    const records = Array.from(turnCache.values())
      .filter(record => record.text && record.text.trim())
      .sort(compareTurns)

    let text = ''
    const turns = []
    for (const record of records) {
      if (text) text += '\n\n'
      const start = text.length
      text += record.text
      turns.push({
        key: record.key,
        role: record.role || '',
        order: Number.isFinite(record.order) ? record.order : null,
        start,
        end: text.length
      })
    }
    return {text, turns}
  }

  function compareTurns(a, b) {
    const aOrder = Number.isFinite(a.order) ? a.order : null
    const bOrder = Number.isFinite(b.order) ? b.order : null
    if (aOrder != null && bOrder != null && aOrder !== bOrder) return aOrder - bOrder
    if (aOrder != null && bOrder == null) return -1
    if (aOrder == null && bOrder != null) return 1

    const aTop = Number.isFinite(a.virtualTop) ? a.virtualTop : null
    const bTop = Number.isFinite(b.virtualTop) ? b.virtualTop : null
    if (aTop != null && bTop != null && Math.abs(aTop - bTop) > 1) return aTop - bTop
    return a.firstSeen - b.firstSeen
  }

  function getTurnIdentity(message) {
    const idRoot = message.closest('[data-turn-id]')
    const testRoot = message.closest('[data-testid^="conversation-turn-"]')
    const structuralRoot = testRoot || idRoot || message.closest('article[data-turn], section[data-turn]') || message
    const testId = testRoot && testRoot.getAttribute('data-testid')
    const turnId = idRoot && idRoot.getAttribute('data-turn-id')
    const messageId = message.getAttribute('data-message-id') || message.getAttribute('data-id')
    const role = message.getAttribute('data-message-author-role') || structuralRoot.getAttribute('data-turn') || ''

    let order = null
    const testMatch = testId && /conversation-turn-(\d+)/i.exec(testId)
    if (testMatch) order = Number(testMatch[1])
    if (!Number.isFinite(order)) {
      const indexValue = structuralRoot.getAttribute && (structuralRoot.getAttribute('data-turn-index') || structuralRoot.getAttribute('aria-posinset'))
      if (indexValue != null && indexValue !== '') order = Number(indexValue)
    }

    const key = turnId
      ? 'turn:' + turnId
      : testId
        ? 'test:' + testId
        : messageId
          ? 'message:' + messageId
          : Number.isFinite(order)
            ? 'order:' + order + ':' + role
            : fallbackTurnKey(message, role)

    return {key, role, order, virtualTop: getVirtualTop(structuralRoot)}
  }

  function fallbackTurnKey(message, role) {
    const text = extractMessageText(message)
    let hash = 2166136261
    const sample = role + '\u0000' + text.slice(0, 600)
    for (let i = 0; i < sample.length; i++) {
      hash ^= sample.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return 'fallback:' + role + ':' + (hash >>> 0).toString(16)
  }

  function getVirtualTop(elem) {
    if (!elem || !elem.getBoundingClientRect) return null
    const scroller = findScrollContainer(elem)
    if (!scroller) return null
    const rect = elem.getBoundingClientRect()
    const scrollRect = scroller.getBoundingClientRect()
    return rect.top - scrollRect.top + scroller.scrollTop
  }

  function findScrollContainer(elem) {
    for (let current = elem && elem.parentElement; current; current = current.parentElement) {
      const style = getComputedStyle(current)
      const overflow = style.overflowY
      if ((overflow === 'auto' || overflow === 'scroll') && current.scrollHeight > current.clientHeight + 20) return current
    }
    return document.scrollingElement || document.documentElement
  }

  function extractMessageText(message) {
    return String(message && message.innerText || '').trim()
  }

  function initializeSession(text, snapshot) {
    sessionText = text
    sourceTokens = tokenizeString(sessionText)
    speechSignature = ''
    speechCache = []
    speechCursor = 0
    domMapCache.clear()

    sessionTurns = snapshot && Array.isArray(snapshot.turns) ? snapshot.turns.map(turn => ({...turn})) : []
    sessionTurnByKey = new Map(sessionTurns.map(turn => [turn.key, turn]))
    for (const turn of sessionTurns) {
      turn.sourceTokenStart = lowerBoundToken(turn.start)
      turn.sourceTokenEnd = lowerBoundToken(turn.end)
    }
  }

  function resolveStoredContextOrigin() {
    if (!pendingContextPoint) return null
    return getAnchorFromPoint(pendingContextPoint, true)
  }

  function getAnchorFromPoint(point, sectionStart) {
    if (!point) return null
    let elem = point.elem
    if (!elem && point.node) elem = point.node.nodeType === Node.ELEMENT_NODE ? point.node : point.node.parentElement
    const message = findMessageElement(elem)
    if (!message) return null

    const record = harvestMessage(message)
    if (!record) return null
    const identity = getTurnIdentity(message)
    const turn = sessionTurnByKey.get(identity.key)
    const block = findReadableBlock(elem, message) || message
    const domTokens = collectDomTokens(message)
    if (!domTokens.length) return null

    let tokenIndex
    if (sectionStart) tokenIndex = firstTokenInsideBlock(domTokens, block)
    else tokenIndex = tokenIndexAtPoint(domTokens, point)
    if (tokenIndex == null) tokenIndex = 0

    let sourceOffset = null
    let sourceTokenIndex = null
    if (turn) {
      const alignment = getTurnDomAlignment(turn, message, domTokens)
      if (alignment) {
        sourceTokenIndex = alignment.domToSource[tokenIndex]
        if (sourceTokenIndex == null) sourceTokenIndex = mappedTokenNear(alignment.domToSource, tokenIndex, 5)
        if (sourceTokenIndex != null) sourceOffset = sourceOffsetForTurnToken(turn, sourceTokenIndex)
      }
    }

    return {
      after: record.text.slice(0, 240),
      before: '',
      sectionStart: !!sectionStart,
      sourceOffset,
      chatgptTurnKey: identity.key,
      chatgptSourceTokenIndex: sourceTokenIndex
    }
  }

  function findMessageElement(target) {
    const elem = target && target.nodeType === Node.ELEMENT_NODE ? target : target && target.parentElement
    return elem && elem.closest ? elem.closest(MESSAGE_SELECTOR) : null
  }

  function findReadableBlock(elem, message) {
    if (!elem || !message) return null
    const block = elem.closest && elem.closest(BLOCK_SELECTOR)
    return block && message.contains(block) ? block : message
  }

  function capturePoint(x, y, target) {
    const caret = getCaretAtPoint(x, y)
    const elem = target && target.nodeType === Node.ELEMENT_NODE ? target : target && target.parentElement
    return {node: caret && caret.node, offset: caret ? caret.offset : 0, elem: elem || document.elementFromPoint(x, y)}
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

  function collectDomTokens(root) {
    const out = []
    if (!root) return out
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      const parent = node.parentElement
      if (!parent || !node.nodeValue || !node.nodeValue.trim()) continue
      if (parent.closest(SKIP_TEXT_SELECTOR)) continue
      const tokens = tokenizeString(node.nodeValue)
      for (const token of tokens) out.push({key: token.key, node, start: token.start, end: token.end})
    }
    return out
  }

  function firstTokenInsideBlock(tokens, block) {
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].node && block.contains(tokens[i].node)) return i
    }
    return 0
  }

  function tokenIndexAtPoint(tokens, point) {
    if (point.node && point.node.nodeType === Node.TEXT_NODE) {
      let best = null
      let bestDistance = Infinity
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]
        if (token.node !== point.node) continue
        let distance = 0
        if (point.offset < token.start) distance = token.start - point.offset
        else if (point.offset > token.end) distance = point.offset - token.end
        if (distance < bestDistance) {
          best = i
          bestDistance = distance
        }
      }
      if (best != null) return best
    }

    const elem = point.elem && point.elem.nodeType === Node.ELEMENT_NODE ? point.elem : null
    if (elem) {
      for (let i = 0; i < tokens.length; i++) if (elem.contains(tokens[i].node)) return i
    }
    return null
  }

  function sourceOffsetForTurnToken(turn, localTokenIndex) {
    if (!turn) return null
    const start = Math.max(0, turn.sourceTokenStart || 0)
    const end = Math.max(start, turn.sourceTokenEnd || start)
    const sourceIndex = Math.min(Math.max(start + localTokenIndex, start), Math.max(start, end - 1))
    const token = sourceTokens[sourceIndex]
    return token ? token.start : turn.start
  }

  function schedulePoll(delay) {
    if (pollTimer) clearTimeout(pollTimer)
    pollTimer = setTimeout(poll, delay)
  }

  async function poll() {
    if (polling) return
    polling = true
    try {
      const info = await send('getPagePlaybackState')
      active = !!(info && info.active)
      if (!active) {
        pendingSelectionBlock = null
        hideHighlight()
      }
      else if (info.state === 'PAUSED' && pendingSelectionBlock && pendingSelectionBlock.isConnected) {
        showElementHighlight(pendingSelectionBlock)
      }
      else {
        if (info.state === 'PLAYING') pendingSelectionBlock = null
        updateSpeechHighlight(info)
      }
    }
    catch (err) {
      active = false
      hideHighlight()
    }
    finally {
      polling = false
      schedulePoll(POLL_INTERVAL)
    }
  }

  function updateSpeechHighlight(info) {
    if (!sessionText || !sourceTokens.length || !info || !info.speech || !Array.isArray(info.speech.texts)) {
      hideHighlight()
      return
    }

    const mapping = resolveSpeechChunk(info)
    if (!mapping) {
      hideHighlight()
      return
    }

    const currentIndex = Number(info.speech.position && info.speech.position.index)
    const text = info.speech.texts[currentIndex]
    const boundary = info.boundary
    const boundaryMatches = boundary && boundary.text === text && boundary.charLength > 0

    let sourceIndex = null
    if (boundaryMatches) {
      const chunkTokenIndex = findTokenAtChar(mapping.chunkTokens, boundary.charIndex)
      sourceIndex = mappedTokenNear(mapping.chunkToSource, chunkTokenIndex)
    }
    if (sourceIndex == null) sourceIndex = firstMappedValue(mapping.chunkToSource)
    if (sourceIndex == null) {
      hideHighlight()
      return
    }

    const turn = findTurnForSourceToken(sourceIndex)
    if (!turn) {
      hideHighlight()
      return
    }

    const message = findMountedMessageByKey(turn.key)
    if (!message) {
      hideHighlight()
      return
    }

    const range = rangeForTurnSourceToken(turn, sourceIndex, message)
    if (!range) {
      showElementHighlight(message)
      return
    }

    const elem = findReadableBlock(range.startContainer.parentElement, message) || message
    showRangeHighlight(range, elem)
  }

  function resolveSpeechChunk(info) {
    const texts = info.speech && info.speech.texts
    if (!texts || !texts.length) return null
    const generation = Number(info.generation || 0)
    const signature = generation + ':' + texts.length + ':' + String(texts[0] || '').slice(0, 80)
    if (signature !== speechSignature) {
      speechSignature = signature
      speechCache = []
      speechCursor = sourceTokenIndexAtOrAfter(Number(info.sessionOffset || 0))
    }

    const target = Number(info.speech.position && info.speech.position.index)
    if (!Number.isInteger(target) || target < 0 || target >= texts.length) return null
    while (speechCache.length <= target) {
      const index = speechCache.length
      const chunkTokens = tokenizeString(String(texts[index] || ''))
      const chunkToSource = alignChunkToSource(chunkTokens, speechCursor)
      const mapped = chunkToSource.filter(value => value != null)
      if (mapped.length) speechCursor = Math.max(speechCursor, mapped[mapped.length - 1] + 1)
      speechCache.push({chunkTokens, chunkToSource})
    }
    return speechCache[target]
  }

  function alignChunkToSource(chunkTokens, startIndex) {
    const out = new Array(chunkTokens.length).fill(null)
    if (!chunkTokens.length) return out
    const from = Math.max(0, Math.min(sourceTokens.length, startIndex || 0))
    const to = Math.min(sourceTokens.length, from + chunkTokens.length + 240)
    const aligned = alignTokenLists(chunkTokens, sourceTokens.slice(from, to), 100)
    for (let i = 0; i < aligned.aToB.length; i++) {
      if (aligned.aToB[i] != null) out[i] = from + aligned.aToB[i]
    }
    return out
  }

  function findTurnForSourceToken(sourceIndex) {
    const token = sourceTokens[sourceIndex]
    if (!token) return null
    let lo = 0
    let hi = sessionTurns.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sessionTurns[mid].end <= token.start) lo = mid + 1
      else hi = mid
    }
    const turn = sessionTurns[lo]
    return turn && token.start >= turn.start && token.start < turn.end ? turn : null
  }

  function findMountedMessageByKey(key) {
    const messages = document.querySelectorAll(MESSAGE_SELECTOR)
    for (const message of messages) {
      if (getTurnIdentity(message).key === key) return message
    }
    return null
  }

  function getTurnDomAlignment(turn, message, domLocal) {
    if (!turn || !message) return null
    const sourceLocal = sourceTokens.slice(turn.sourceTokenStart, turn.sourceTokenEnd)
    if (!domLocal) domLocal = collectDomTokens(message)
    if (!sourceLocal.length || !domLocal.length) return null

    const signature = turn.key + ':' + extractMessageText(message).slice(0, 160) + ':' + domLocal.length
    let cached = domMapCache.get(turn.key)
    if (!cached || cached.signature !== signature) {
      const aligned = alignTokenLists(sourceLocal, domLocal, 100)
      cached = {
        signature,
        sourceToDom: aligned.aToB,
        domToSource: aligned.bToA,
        domLocal
      }
      domMapCache.set(turn.key, cached)
    }
    return cached
  }

  function rangeForTurnSourceToken(turn, sourceIndex, message) {
    const localIndex = sourceIndex - turn.sourceTokenStart
    if (localIndex < 0) return null

    const cached = getTurnDomAlignment(turn, message)
    if (!cached) return null

    let domIndex = cached.sourceToDom[localIndex]
    if (domIndex == null) {
      for (let distance = 1; distance < Math.min(cached.sourceToDom.length, 24); distance++) {
        if (localIndex + distance < cached.sourceToDom.length && cached.sourceToDom[localIndex + distance] != null) {
          domIndex = cached.sourceToDom[localIndex + distance]
          break
        }
        if (localIndex - distance >= 0 && cached.sourceToDom[localIndex - distance] != null) {
          domIndex = cached.sourceToDom[localIndex - distance]
          break
        }
      }
    }
    const token = domIndex != null ? cached.domLocal[domIndex] : null
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

  function installGenericHighlightSuppressor() {
    const install = () => {
      if (genericHighlightStyle || !document.documentElement) return
      genericHighlightStyle = document.createElement('style')
      genericHighlightStyle.textContent = '#read-aloud-firefox-highlight{display:none!important}'
      document.documentElement.appendChild(genericHighlightStyle)
    }
    if (document.documentElement) install()
    else document.addEventListener('readystatechange', install, {once: true})
  }

  function ensureHighlight() {
    if (highlight && highlight.isConnected) return
    highlight = document.createElement('div')
    highlight.id = 'read-aloud-firefox-chatgpt-highlight'
    Object.assign(highlight.style, {
      position: 'fixed',
      display: 'none',
      pointerEvents: 'none',
      zIndex: '2147483646',
      borderRadius: '4px',
      background: 'rgba(255, 213, 79, .28)',
      boxShadow: '0 0 0 2px rgba(255, 193, 7, .58) inset',
      transition: 'top .10s ease, left .10s ease, width .10s ease, height .10s ease'
    })
    document.documentElement.appendChild(highlight)
  }

  function showRangeHighlight(range, elem) {
    ensureHighlight()
    highlight._raRange = range
    highlight._raElement = elem
    refreshHighlightRect()
  }

  function showElementHighlight(elem) {
    if (!elem || !elem.isConnected) return
    ensureHighlight()
    highlight._raRange = null
    highlight._raElement = elem
    refreshHighlightRect()
  }

  function refreshHighlightRect() {
    if (!highlight || !highlight._raElement || !highlight._raElement.isConnected) return
    let rect = null
    if (highlight._raRange) {
      try {
        const rangeRect = highlight._raRange.getBoundingClientRect()
        if (rangeRect.width && rangeRect.height) rect = rangeRect
      }
      catch (err) {}
    }
    if (!rect) rect = highlight._raElement.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) {
      highlight.style.display = 'none'
      return
    }

    const left = Math.max(0, rect.left - 3)
    const top = Math.max(0, rect.top - 2)
    highlight.style.display = 'block'
    highlight.style.left = left + 'px'
    highlight.style.top = top + 'px'
    highlight.style.width = Math.max(0, Math.min(innerWidth - left, rect.width + 6)) + 'px'
    highlight.style.height = rect.height + 4 + 'px'
  }

  function hideHighlight() {
    if (!highlight) return
    highlight.style.display = 'none'
    highlight._raRange = null
    highlight._raElement = null
  }

  function isControllerEvent(event) {
    return event.composedPath().some(node => node && node.id === 'read-aloud-firefox-controller')
  }

  function tokenizeString(text) {
    const tokens = []
    const value = String(text || '')
    let re
    try {
      re = new RegExp("[\\p{L}\\p{N}]+(?:['’][\\p{L}\\p{N}]+)*", 'gu')
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
      const aAhead = findKeyAhead(b, j + 1, Math.min(b.length, j + 16), a[i].key)
      const bAhead = findKeyAhead(a, i + 1, Math.min(a.length, i + 16), b[j].key)
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

  function lowerBoundToken(offset) {
    let lo = 0
    let hi = sourceTokens.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sourceTokens[mid].end <= offset) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  function sourceTokenIndexAtOrAfter(offset) {
    if (!sourceTokens.length) return 0
    return Math.max(0, Math.min(sourceTokens.length - 1, lowerBoundToken(offset)))
  }

  function findTokenAtChar(tokens, charIndex) {
    if (!tokens.length) return 0
    for (let i = 0; i < tokens.length; i++) {
      if (charIndex >= tokens[i].start && charIndex < tokens[i].end) return i
      if (tokens[i].start >= charIndex) return i
    }
    return tokens.length - 1
  }

  function mappedTokenNear(mapping, index, maxDistance) {
    if (!mapping.length) return null
    const start = Math.max(0, Math.min(mapping.length - 1, index || 0))
    if (mapping[start] != null) return mapping[start]
    const limit = Math.max(1, Number(maxDistance) || 15)
    for (let distance = 1; distance <= limit && distance < mapping.length; distance++) {
      if (start + distance < mapping.length && mapping[start + distance] != null) return mapping[start + distance]
      if (start - distance >= 0 && mapping[start - distance] != null) return mapping[start - distance]
    }
    return null
  }

  function firstMappedValue(mapping) {
    for (const value of mapping) if (value != null) return value
    return null
  }

  function send(method, ...args) {
    return api.runtime.sendMessage({method, args}).then(result => {
      if (result && result.error) throw new Error(result.error)
      return result
    })
  }
})()
