;(function() {
  if (typeof handlers == "undefined" || typeof readSessions == "undefined") return

  const originalGetPagePlaybackState = handlers.getPagePlaybackState
  const originalPause = pause
  const originalPlayTab = playTab
  let readSessionSerial = 0
  let rateRestartTimer = null
  let latestReadAloudRate = null
  const RATE_RESTART_DELAY = 600

  startReadAloud = async function(tab) {
    if (!tab || tab.id == null || tab.id == -1) return

    const tabId = tab.id
    const previousTabId = activeReadTabId
    if (previousTabId != null) await resetPageMapping(previousTabId)
    await stop()
    await resetPageMapping(tabId)

    const serial = ++readSessionSerial
    const session = {
      tabId: tabId,
      fullText: "",
      lang: null,
      offset: 0,
      loading: true,
      pageMapReady: false,
      refreshMapAfterStart: true,
      generationBase: serial * 1000000,
      generationCount: 0
    }
    activeReadTabId = tabId
    readSessions[tabId] = session
    updateReadAloudMenus(tabId)

    let source
    try {
      source = new TabSource(tabId)
      const info = await source.ready
      let index = await source.getCurrentIndex()
      if (index == null || index < 0) index = 0
      const texts = await source.getTexts(index)
      if (!texts || !texts.length) throw new Error(JSON.stringify({code: "error_no_text"}))

      session.fullText = texts.join("\n\n")
      session.lang = info && (info.lang || info.detectedLang)
      if (!session.lang) session.lang = await detectTabLanguage(tabId)
      session.offset = findAnchorOffset(session.fullText, contextOrigins[tabId])

      await source.close()
      source = null
      await restartReadSession(tabId, session.offset)
    }
    catch (err) {
      if (source) source.close()
      finishReadSession(tabId)
      handleError(err)
      throw err
    }
  }

  findAnchorOffset = function(text, anchor) {
    if (!anchor) return 0
    const directOffset = Number(anchor.sourceOffset)
    if (Number.isFinite(directOffset)) return Math.max(0, Math.min(text.length, Math.round(directOffset)))
    if (!anchor.after) return 0

    const indexed = normalizeWithMap(text)
    const before = normalizeAnchor(anchor.before || "")
    const after = normalizeAnchor(anchor.after || "")
    if (!after || !indexed.text.length) return 0

    let progress = Number(anchor.progress)
    if (!Number.isFinite(progress) && Number(anchor.blockCount) > 1 && Number(anchor.blockIndex) >= 0) {
      progress = Number(anchor.blockIndex) / (Number(anchor.blockCount) - 1)
    }
    if (Number.isFinite(progress)) progress = Math.max(0, Math.min(1, progress))
    const expected = Number.isFinite(progress) ? progress * (indexed.text.length - 1) : null

    const candidates = []
    if (before) {
      candidates.push({query: before + " " + after, target: before.length + 1})
    }

    const lengths = [240, 180, 140, 100, 72, 48, 28]
    for (const length of lengths) {
      if (after.length >= Math.min(length, 28)) {
        candidates.push({query: after.slice(0, Math.min(length, after.length)), target: 0})
      }
    }

    for (const candidate of candidates) {
      const result = nearestOccurrence(indexed, candidate.query.toLowerCase(), candidate.target, expected)
      if (result != null) return result
    }

    const words = after.split(" ").filter(Boolean)
    if (words.length) {
      const shortAnchor = words.slice(0, Math.min(8, words.length)).join(" ").toLowerCase()
      const result = nearestOccurrence(indexed, shortAnchor, 0, expected)
      if (result != null) return result
    }

    if (expected != null && indexed.map.length) {
      const pos = Math.max(0, Math.min(indexed.map.length - 1, Math.round(expected)))
      return indexed.map[pos] || 0
    }
    return 0
  }

  seekReadSession = async function(tabId, anchor) {
    const session = readSessions[tabId]
    if (!session || tabId !== activeReadTabId) return

    const offset = findAnchorOffset(session.fullText, anchor)
    if (offset == null) return

    const state = await getPlaybackState()
    const autoplay = !(session.paused || state == "PAUSED")
    return restartReadSession(tabId, offset, autoplay)
  }

  handlers.setReadAloudRate = function(rate) {
    const normalizedRate = normalizeReadAloudRate(rate)
    latestReadAloudRate = normalizedRate

    if (rateRestartTimer) clearTimeout(rateRestartTimer)
    rateRestartTimer = setTimeout(function() {
      rateRestartTimer = null
      Promise.resolve(updateSettings({rate: latestReadAloudRate}))
        .then(restartCurrentSentenceWithRate)
        .catch(handleError)
    }, RATE_RESTART_DELAY)

    return updateSettings({rate: normalizedRate}).then(function() {
      return normalizedRate
    })
  }

  restartReadSession = async function(tabId, offset, autoplay) {
    const session = readSessions[tabId]
    if (!session || tabId !== activeReadTabId) return
    if (autoplay == null) autoplay = true

    let effectiveOffset = Math.max(0, Math.min(Number(offset) || 0, session.fullText.length))
    if (!session.pageMapReady) {
      const init = await initializePageSession(tabId, session)
      const exactOrigin = init && init.contextOrigin && Number(init.contextOrigin.sourceOffset)
      if (Number.isFinite(exactOrigin)) effectiveOffset = Math.max(0, Math.min(session.fullText.length, Math.round(exactOrigin)))
      session.pageMapReady = true
    }

    session.loading = true
    session.offset = effectiveOffset
    session.generationCount = (session.generationCount || 0) + 1
    session.generation = (session.generationBase || 0) + session.generationCount
    session.paused = !autoplay
    await stopActiveDocOnly()

    let text = session.fullText.slice(session.offset)
    if (!text.trim()) {
      session.offset = 0
      text = session.fullText
    }

    playbackError = null
    openDoc(new SimpleSource(text.split(/(?:\r?\n){2,}/), {lang: session.lang}), function(err) {
      if (err) playbackError = err
      if (activeReadTabId === tabId) finishReadSession(tabId)
    })

    session.loading = false
    if (!autoplay) return

    try {
      session.paused = false
      const result = await activeDoc.play()
      if (session.refreshMapAfterStart && activeReadTabId === tabId && readSessions[tabId] === session) {
        session.refreshMapAfterStart = false
        await initializePageSession(tabId, session)
      }
      return result
    }
    catch (err) {
      handleError(err)
      closeDoc()
      finishReadSession(tabId)
      throw err
    }
  }

  pause = function() {
    markActiveReadSessionPaused(true)
    return originalPause.apply(this, arguments)
  }
  handlers.pause = pause

  playTab = function() {
    markActiveReadSessionPaused(false)
    return originalPlayTab.apply(this, arguments)
  }
  handlers.playTab = playTab

  handlers.pageTogglePlayback = async function() {
    const tabId = this.sender.tab && this.sender.tab.id
    const session = tabId != null ? readSessions[tabId] : null
    if (!session || tabId !== activeReadTabId || !activeDoc) return

    if (session.paused) {
      session.paused = false
      return activeDoc.play()
    }

    const state = await getPlaybackState()
    if (state == "PLAYING" || state == "LOADING") {
      session.paused = true
      return originalPause()
    }
    if (state == "PAUSED" || state == "STOPPED") {
      session.paused = false
      return activeDoc.play()
    }
  }

  handlers.getPagePlaybackState = async function() {
    const result = await originalGetPagePlaybackState.apply(this, arguments)
    const tabId = this.sender.tab && this.sender.tab.id
    const session = tabId != null ? readSessions[tabId] : null
    if (!result || !result.active || !session || tabId !== activeReadTabId) return result

    result.sessionOffset = session.offset || 0
    result.sessionLength = session.fullText ? session.fullText.length : 0
    result.sessionProgress = result.sessionLength ? result.sessionOffset / result.sessionLength : 0
    result.generation = session.generation || 0
    if (session.paused && result.state != "LOADING") result.state = "PAUSED"
    return result
  }

  async function restartCurrentSentenceWithRate() {
    const tabId = activeReadTabId
    const session = tabId != null ? readSessions[tabId] : null
    if (!session || !activeDoc || tabId !== activeReadTabId) return

    const state = await getPlaybackState()
    if (state == "STOPPED") return
    const autoplay = !(session.paused || state == "PAUSED")
    const offset = await getCurrentSentenceSessionOffset(session)
    return restartReadSession(tabId, offset, autoplay)
  }

  async function getCurrentSentenceSessionOffset(session) {
    const speech = await getActiveSpeech()
    if (!speech || !session.fullText) return session.offset || 0

    const info = speech.getInfo()
    if (!info || !Array.isArray(info.texts) || !info.texts.length) return session.offset || 0

    const position = info.position || {}
    let index = Number(position.index)
    if (!Number.isInteger(index)) index = 0
    index = Math.max(0, Math.min(info.texts.length - 1, index))

    let speechPrefix = info.texts.slice(0, index).join("")
    if (info.engine != "Piper" && info.engine != "Supertonic") {
      const currentText = String(info.texts[index] || "")
      let sentenceStart = 0
      if (typeof firefoxReadAloudBoundary != "undefined" && firefoxReadAloudBoundary && firefoxReadAloudBoundary.text === currentText) {
        sentenceStart = findSentenceStart(currentText, Number(firefoxReadAloudBoundary.charIndex) || 0)
      }
      speechPrefix += currentText.slice(0, sentenceStart)
    }

    const tokenOrdinal = countRateTokens(speechPrefix)
    if (tokenOrdinal <= 0) return session.offset || 0

    const remaining = session.fullText.slice(session.offset || 0)
    const sourceTokens = getRateTokenOffsets(remaining)
    if (tokenOrdinal >= sourceTokens.length) return session.offset || 0
    return (session.offset || 0) + sourceTokens[tokenOrdinal].start
  }

  function findSentenceStart(text, charIndex) {
    const limit = Math.max(0, Math.min(Number(charIndex) || 0, text.length))
    let start = 0
    const re = /[.!?]+[\s\u200b]+/g
    let match
    while ((match = re.exec(text))) {
      const end = match.index + match[0].length
      if (end > limit) break
      start = end
    }
    while (start < text.length && /\s/.test(text[start])) start++
    return start
  }

  function countRateTokens(text) {
    return getRateTokenOffsets(text).length
  }

  function getRateTokenOffsets(text) {
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
    while ((match = re.exec(value))) tokens.push({start: match.index, end: match.index + match[0].length})
    return tokens
  }

  function normalizeReadAloudRate(rate) {
    const value = Number(rate)
    if (!Number.isFinite(value)) return 1
    return Math.round(Math.min(10, Math.max(.1, value)) * 1000000) / 1000000
  }

  function resetPageMapping(tabId) {
    if (tabId == null || tabId == -1 || !brapi.tabs || !brapi.tabs.sendMessage) return Promise.resolve()
    return brapi.tabs.sendMessage(tabId, {
      method: "firefoxReadAloudInitSession",
      args: [""]
    }).catch(function() {})
  }

  function initializePageSession(tabId, session) {
    if (!brapi.tabs || !brapi.tabs.sendMessage) return Promise.resolve(null)
    return brapi.tabs.sendMessage(tabId, {
      method: "firefoxReadAloudInitSession",
      args: [session.fullText]
    }).catch(function() {
      return null
    })
  }

  function markActiveReadSessionPaused(value) {
    if (activeReadTabId == null) return
    const session = readSessions[activeReadTabId]
    if (session) session.paused = !!value
  }

  function nearestOccurrence(indexed, query, target, expected) {
    if (!query) return null
    let from = 0
    let bestTarget = null
    let bestDistance = Infinity

    while (from <= indexed.text.length - query.length) {
      const pos = indexed.text.indexOf(query, from)
      if (pos < 0) break
      const targetPos = Math.max(0, Math.min(indexed.map.length - 1, pos + target))
      const distance = expected == null ? pos : Math.abs(targetPos - expected)
      if (distance < bestDistance) {
        bestDistance = distance
        bestTarget = targetPos
      }
      from = pos + 1
    }

    return bestTarget == null ? null : (indexed.map[bestTarget] || 0)
  }
})()
