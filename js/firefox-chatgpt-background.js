;(function() {
  if (typeof startReadAloud == 'undefined' || typeof seekReadSession == 'undefined' || typeof restartReadSession == 'undefined') return

  const originalStartReadAloud = startReadAloud
  const originalSeekReadSession = seekReadSession
  let chatgptSessionSerial = 0

  startReadAloud = async function(tab) {
    if (!isChatgptTab(tab)) return originalStartReadAloud.apply(this, arguments)
    if (!tab || tab.id == null || tab.id == -1) return

    const tabId = tab.id
    const previousTabId = activeReadTabId
    if (previousTabId != null) await resetPageMappings(previousTabId)
    await stop()
    await resetPageMappings(tabId)

    const snapshot = await getChatgptSnapshot(tabId)
    if (!snapshot || !snapshot.text || !snapshot.text.trim()) {
      return originalStartReadAloud(tab)
    }

    const serial = ++chatgptSessionSerial
    const session = {
      tabId,
      fullText: snapshot.text,
      lang: await detectTabLanguage(tabId),
      offset: 0,
      loading: true,
      paused: false,
      pageMapReady: true,
      refreshMapAfterStart: false,
      generationBase: 900000000 + serial * 1000000,
      generationCount: 0,
      chatgpt: true,
      chatgptSnapshot: snapshot
    }

    activeReadTabId = tabId
    readSessions[tabId] = session
    updateReadAloudMenus(tabId)

    try {
      const init = await initializeChatgptSession(tabId, session)
      const anchor = (init && init.contextOrigin) || contextOrigins[tabId]
      const offset = resolveChatgptAnchorOffset(session, anchor)
      session.offset = offset != null ? offset : 0
      await restartReadSession(tabId, session.offset, true)
    }
    catch (err) {
      finishReadSession(tabId)
      handleError(err)
      throw err
    }
  }

  seekReadSession = async function(tabId, anchor) {
    const session = readSessions[tabId]
    if (!session || !session.chatgpt) return originalSeekReadSession.apply(this, arguments)
    if (tabId !== activeReadTabId) return

    const state = await getPlaybackState()
    const autoplay = !(session.paused || state == 'PAUSED')

    const snapshot = await getChatgptSnapshot(tabId)
    if (snapshot && snapshot.text && snapshot.text.trim()) {
      session.fullText = snapshot.text
      session.chatgptSnapshot = snapshot
    }

    const offset = resolveChatgptAnchorOffset(session, anchor)
    // Never degrade an unmapped ChatGPT click into source offset zero.
    if (offset == null) return

    session.pageMapReady = true
    session.refreshMapAfterStart = false
    await initializeChatgptSession(tabId, session)
    return restartReadSession(tabId, offset, autoplay)
  }

  function isChatgptTab(tab) {
    if (!tab || !tab.url) return false
    try {
      const host = new URL(tab.url).hostname.toLowerCase()
      return host === 'chatgpt.com' || host === 'www.chatgpt.com' || host === 'chat.openai.com'
    }
    catch (err) {
      return false
    }
  }

  async function getChatgptSnapshot(tabId) {
    try {
      return await brapi.tabs.sendMessage(tabId, {method: 'firefoxChatgptGetSnapshot', args: []})
    }
    catch (err) {
      return null
    }
  }

  async function initializeChatgptSession(tabId, session) {
    try {
      return await brapi.tabs.sendMessage(tabId, {
        method: 'firefoxChatgptInitSession',
        args: [session.fullText, session.chatgptSnapshot]
      })
    }
    catch (err) {
      return null
    }
  }

  async function resetPageMappings(tabId) {
    if (tabId == null || tabId == -1 || !brapi.tabs || !brapi.tabs.sendMessage) return
    await Promise.all([
      brapi.tabs.sendMessage(tabId, {method: 'firefoxReadAloudInitSession', args: ['']}).catch(function() {}),
      brapi.tabs.sendMessage(tabId, {method: 'firefoxChatgptInitSession', args: ['', {text: '', turns: []}]}).catch(function() {})
    ])
  }

  function resolveChatgptAnchorOffset(session, anchor) {
    if (!session || !anchor || !session.chatgptSnapshot || !Array.isArray(session.chatgptSnapshot.turns)) return null

    if (anchor.chatgptTurnKey) {
      const turn = session.chatgptSnapshot.turns.find(item => item.key === anchor.chatgptTurnKey)
      if (turn) {
        const turnText = session.fullText.slice(turn.start, turn.end)
        const tokens = tokenize(turnText)
        if (tokens.length) {
          const tokenIndex = Math.max(0, Math.min(tokens.length - 1, Number(anchor.chatgptTokenIndex) || 0))
          return turn.start + tokens[tokenIndex].start
        }
        return turn.start
      }
    }

    const direct = Number(anchor.sourceOffset)
    if (Number.isFinite(direct) && direct >= 0 && direct <= session.fullText.length) return Math.round(direct)
    return null
  }

  function tokenize(text) {
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
    while ((match = re.exec(value))) tokens.push({start: match.index, end: match.index + match[0].length})
    return tokens
  }
})()
