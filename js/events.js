
var activeDoc;
var activeReadTabId = null;
var readSessions = {};
var contextOrigins = {};
var playbackError = null;
var silenceLoop = new Audio("sound/silence.opus");
silenceLoop.loop = true;
const pdfViewerCheckIn$ = new rxjs.Subject()

const audioPlayer = immediate(() => {
  let current
  return {
    play(src, opts) {
      if (current) current.playback.unsubscribe()
      const isBlob = src instanceof Blob
      const url = isBlob ? URL.createObjectURL(src) : src
      const playbackState$ = new rxjs.BehaviorSubject("resumed")
      return new Promise((fulfill, reject) => {
        current = {
          playbackState$,
          playback: playAudio(Promise.resolve(url), opts, playbackState$).subscribe({
            complete: fulfill,
            error: reject
          })
        }
        if (isBlob) current.playback.add(() => URL.revokeObjectURL(url))
      })
    },
    pause() {
      if (current) current.playbackState$.next("paused")
    },
    resume() {
      if (current) current.playbackState$.next("resumed")
    }
  }
})

installContextMenus()


/**
 * Piper
 */
const piperHost = immediate(() => {
  const tabSubject = new rxjs.BehaviorSubject(null)
  return {
    setTab(tab) {
      tabSubject.next(tab)
    },
    async ready({requestFocus}) {
      if (requestFocus) {
        const windows = brapi.extension.getViews({type: "popup"})
        for (const w of windows) w.close()
      }
      try {
        const tab = tabSubject.getValue()
        if (!tab) throw "Absent"
        const status = await this.sendRequest("areYouThere")
        if (status != true) throw "Absent"
        if (requestFocus) {
          await Promise.all([
            chrome.windows.update(tab.windowId, {focused: true}),
            chrome.tabs.update(tab.id, {active: true})
          ])
        }
      }
      catch (err) {
        tabSubject.next(null)
        await brapi.tabs.create({url: "https://piper.ttstool.com/", pinned: true, active: requestFocus})
        await rxjs.firstValueFrom(tabSubject.pipe(rxjs.filter(x => x)))
      }
    },
    async sendRequest(method, args) {
      const tab = tabSubject.getValue()
      const {error, result} = await brapi.tabs.sendMessage(tab.id, {
        to: "piper-host",
        type: "request",
        id: String(Math.random()),
        method,
        args
      })
      return error ? Promise.reject(error) : result
    },
    eventSubject: new rxjs.Subject()
  }
})


/**
 * Supertonic
 */
const supertonicHost = immediate(() => {
  const tabSubject = new rxjs.BehaviorSubject(null)
  return {
    setTab(tab) {
      tabSubject.next(tab)
    },
    async ready({requestFocus}) {
      if (requestFocus) {
        const windows = brapi.extension.getViews({type: "popup"})
        for (const w of windows) w.close()
      }
      try {
        const tab = tabSubject.getValue()
        if (!tab) throw "Absent"
        const status = await this.sendRequest("areYouThere")
        if (status != true) throw "Absent"
        if (requestFocus) {
          await Promise.all([
            chrome.windows.update(tab.windowId, {focused: true}),
            chrome.tabs.update(tab.id, {active: true})
          ])
        }
      }
      catch (err) {
        tabSubject.next(null)
        await brapi.tabs.create({url: "https://supertonic.ttstool.com/", pinned: true, active: requestFocus})
        await rxjs.firstValueFrom(tabSubject.pipe(rxjs.filter(x => x)))
      }
    },
    async sendRequest(method, args) {
      const tab = tabSubject.getValue()
      const {error, result} = await brapi.tabs.sendMessage(tab.id, {
        to: "supertonic-host",
        type: "request",
        id: String(Math.random()),
        method,
        args
      })
      return error ? Promise.reject(error) : result
    },
    eventSubject: new rxjs.Subject()
  }
})


/**
 * IPC handlers
 */
var handlers = {
  playText: playText,
  playTab: playTab,
  stop: stop,
  pause: pause,
  getPlaybackState: getPlaybackState,
  forward: forward,
  rewind: rewind,
  seek: seek,
  pageContextOrigin: function(origin) {
    const tabId = this.sender.tab && this.sender.tab.id
    if (tabId != null && tabId != -1 && origin) contextOrigins[tabId] = origin
    return true
  },
  getPagePlaybackState: async function() {
    const tabId = this.sender.tab && this.sender.tab.id
    const session = tabId != null ? readSessions[tabId] : null
    if (!session || tabId !== activeReadTabId) return {active: false}
    if (session.loading) return {active: true, state: "LOADING", speech: null}
    const speech = await getActiveSpeech()
    return {
      active: true,
      state: await getPlaybackState(),
      speech: speech ? speech.getInfo() : null
    }
  },
  pageTogglePlayback: async function() {
    const tabId = this.sender.tab && this.sender.tab.id
    if (tabId == null || tabId !== activeReadTabId) return
    const state = await getPlaybackState()
    if (state == "PLAYING") return pause()
    if (state == "PAUSED" && activeDoc) return activeDoc.play()
  },
  pageStop: function() {
    const tabId = this.sender.tab && this.sender.tab.id
    if (tabId != null && tabId === activeReadTabId) return stop()
  },
  pageSeek: function(anchor) {
    const tabId = this.sender.tab && this.sender.tab.id
    if (tabId != null && tabId === activeReadTabId) return seekReadSession(tabId, anchor)
  },
  reportIssue: reportIssue,
  authWavenet: authWavenet,
  ibmFetchVoices: function(apiKey, url) {
    return ibmWatsonTtsEngine.fetchVoices(apiKey, url);
  },
  getSpeechInfo: function() {
    return getActiveSpeech()
      .then(function(speech) {
        return speech && speech.getInfo();
      })
  },
  getPlaybackError: function() {
    try {
      if (playbackError) return {message: playbackError.message}
    } finally {
      playbackError = null
    }
  },
  startPairing: function() {
    return phoneTtsEngine.startPairing()
  },
  isPaired: function() {
    return phoneTtsEngine.isPaired()
  },
  managePiperVoices() {
    return piperHost.ready({requestFocus: true})
  },
  piperServiceReady: function() {
    piperHost.setTab(this.sender.tab)
  },
  onPiperEvent(event) {
    piperHost.eventSubject.next(event)
  },
  manageSupertonicVoices() {
    return supertonicHost.ready({requestFocus: true})
  },
  supertonicServiceReady() {
    supertonicHost.setTab(this.sender.tab)
  },
  onSupertonicEvent(event) {
    supertonicHost.eventSubject.next(event)
  },
  audioPlay: audioPlayer.play,
  audioPause: audioPlayer.pause,
  audioResume: audioPlayer.resume,
  pdfViewerCheckIn() {
    pdfViewerCheckIn$.next()
  },
}

brapi.runtime.onMessage.addListener(
  function(request, sender, sendResponse) {
    var handler = handlers[request.method];
    if (handler) {
      Promise.resolve(handler.apply({sender}, request.args || []))
        .then(sendResponse)
        .catch(function(err) {
          sendResponse({error: err.message});
        })
      return true;
    }
    else {
      sendResponse({error: "BAD_METHOD"});
    }
  }
);


/**
 * Context menu installer & handlers
 */
function installContextMenus() {
  if (brapi.menus && brapi.menus.create) {
    brapi.menus.create({
      id: "read-page",
      title: "Read aloud",
      contexts: ["page", "selection", "link", "image"],
      visible: true
    });
    brapi.menus.create({
      id: "stop-reading",
      title: "Stop reading",
      contexts: ["page", "selection", "link", "image"],
      visible: false
    });
    brapi.menus.create({
      id: "options",
      title: brapi.i18n.getMessage("options_heading"),
      contexts: ["browser_action"]
    })
  }
}

function updateReadAloudMenus(tabId) {
  if (!brapi.menus || !brapi.menus.update) return Promise.resolve()
  const reading = tabId != null && tabId === activeReadTabId && !!readSessions[tabId]
  return Promise.all([
    brapi.menus.update("read-page", {visible: !reading, enabled: !reading}),
    brapi.menus.update("stop-reading", {visible: reading, enabled: reading})
  ])
  .then(function() {
    if (brapi.menus.refresh) brapi.menus.refresh()
  })
  .catch(function() {})
}

if (brapi.menus && brapi.menus.onShown)
brapi.menus.onShown.addListener(function(info, tab) {
  updateReadAloudMenus(tab && tab.id)
})

brapi.menus.onClicked.addListener(function(info, tab) {
  if (info.menuItemId == "read-page")
    startReadAloud(tab).catch(console.error)
  else if (info.menuItemId == "stop-reading")
    stop().catch(console.error)
  else if (info.menuItemId == "read-selection")
    stop()
      .then(function() {
        if (tab && tab.id != -1) return detectTabLanguage(tab.id)
        else return undefined
      })
      .then(function(lang) {
        return playText(info.selectionText, {lang: lang})
      })
      .catch(console.error)
  else if (info.menuItemId == "options")
    createTab(brapi.runtime.getURL("options.html"))
})


/**
 * Shortcut keys handlers
 */
function execCommand(command) {
  if (command == "play" || command == "pause") {
    getPlaybackState()
      .then(function(state) {
        if (state == "PLAYING") return command == "pause" ? pause() : stop()
        else if (state == "STOPPED" || state == "PAUSED") return playTab()
      })
      .catch(console.error)
  }
  else if (command == "stop") stop();
  else if (command == "forward") forward();
  else if (command == "rewind") rewind();
}

if (brapi.commands)
brapi.commands.onCommand.addListener(function(command) {
  execCommand(command)
})



/**
 * Firefox page read-aloud sessions
 */
async function startReadAloud(tab) {
  if (!tab || tab.id == null || tab.id == -1) return
  await stop()

  const tabId = tab.id
  const session = {
    tabId: tabId,
    fullText: "",
    lang: null,
    offset: 0,
    loading: true
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

async function seekReadSession(tabId, anchor) {
  const session = readSessions[tabId]
  if (!session || tabId !== activeReadTabId) return
  const offset = findAnchorOffset(session.fullText, anchor)
  if (offset == null) return
  return restartReadSession(tabId, offset)
}

async function restartReadSession(tabId, offset) {
  const session = readSessions[tabId]
  if (!session || tabId !== activeReadTabId) return

  session.loading = true
  session.offset = Math.max(0, Math.min(Number(offset) || 0, session.fullText.length))
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

  try {
    session.loading = false
    return await activeDoc.play()
  }
  catch (err) {
    session.loading = false
    handleError(err)
    closeDoc()
    finishReadSession(tabId)
    throw err
  }
}

async function stopActiveDocOnly() {
  if (!activeDoc) return
  try {
    await activeDoc.stop()
  }
  catch (err) {}
  closeDoc()
}

function finishReadSession(tabId) {
  delete readSessions[tabId]
  if (activeReadTabId === tabId) activeReadTabId = null
  updateReadAloudMenus(tabId)
}

function findAnchorOffset(text, anchor) {
  if (!anchor || !anchor.after) return 0

  const indexed = normalizeWithMap(text)
  const before = normalizeAnchor(anchor.before || "")
  const after = normalizeAnchor(anchor.after || "")
  if (!after) return 0

  const candidates = []
  if (before) {
    candidates.push({
      query: before + " " + after,
      target: before.length + 1
    })
  }

  const lengths = [180, 140, 100, 72, 48, 28]
  for (const length of lengths) {
    if (after.length >= Math.min(length, 28)) {
      candidates.push({query: after.slice(0, Math.min(length, after.length)), target: 0})
    }
  }

  for (const candidate of candidates) {
    const pos = indexed.text.indexOf(candidate.query.toLowerCase())
    if (pos >= 0) {
      const targetPos = Math.min(pos + candidate.target, indexed.map.length - 1)
      return targetPos >= 0 ? indexed.map[targetPos] : 0
    }
  }

  const words = after.split(" ").filter(Boolean)
  if (words.length) {
    const shortAnchor = words.slice(0, Math.min(6, words.length)).join(" ").toLowerCase()
    const pos = indexed.text.indexOf(shortAnchor)
    if (pos >= 0) return indexed.map[pos] || 0
  }

  return 0
}

function normalizeWithMap(text) {
  let out = ""
  const map = []
  let lastWasSpace = false

  for (let i=0; i<text.length; i++) {
    const char = text[i]
    if (/\s/.test(char)) {
      if (out && !lastWasSpace) {
        out += " "
        map.push(i)
        lastWasSpace = true
      }
    }
    else {
      out += char.toLowerCase()
      map.push(i)
      lastWasSpace = false
    }
  }

  if (out.endsWith(" ")) {
    out = out.slice(0, -1)
    map.pop()
  }
  return {text: out, map: map}
}

function normalizeAnchor(text) {
  return String(text || "").replace(/\s+/g, " ").trim().toLowerCase()
}


/**
 * METHODS
 */
function playText(text, opts) {
  opts = opts || {}
  playbackError = null
  if (!activeDoc) {
    openDoc(new SimpleSource(text.split(/(?:\r?\n){2,}/), {lang: opts.lang}), function(err) {
      if (err) playbackError = err
    })
  }
  return activeDoc.play()
    .catch(function(err) {
      handleError(err);
      closeDoc();
      throw err;
    })
}

function playTab(tabId) {
  playbackError = null
  if (!activeDoc) {
    openDoc(new TabSource(tabId), function(err) {
      if (err) playbackError = err
    })
  }
  return activeDoc.play()
    .catch(function(err) {
      handleError(err);
      closeDoc();
      throw err;
    })
}

async function stop() {
  const tabId = activeReadTabId
  await stopActiveDocOnly()
  if (tabId != null) finishReadSession(tabId)
}

function pause() {
  if (activeDoc) return activeDoc.pause();
  else return Promise.resolve();
}

function getPlaybackState() {
  if (activeDoc) return activeDoc.getState();
  else return Promise.resolve("STOPPED");
}

function getActiveSpeech() {
  if (activeDoc) return activeDoc.getActiveSpeech();
  else return Promise.resolve(null);
}

function openDoc(source, onEnd) {
  activeDoc = new Doc(source, function(err) {
    handleError(err);
    closeDoc();
    if (typeof onEnd == "function") onEnd(err);
  })
  silenceLoop.play();
}

function closeDoc() {
  if (activeDoc) {
    activeDoc.close();
    activeDoc = null;
    silenceLoop.pause();
  }
}

function forward() {
  if (activeDoc) return activeDoc.forward();
  else return Promise.reject(new Error("Can't forward, not active"));
}

function rewind() {
  if (activeDoc) return activeDoc.rewind();
  else return Promise.reject(new Error("Can't rewind, not active"));
}

function seek(n) {
  if (activeDoc) return activeDoc.seek(n);
  else return Promise.reject(new Error("Can't seek, not active"));
}

function handleError(err) {
  if (err) {
    if (/^{/.test(err.message)) {
      const errInfo = JSON.parse(err.message)
      switch (errInfo.code) {
        case "error_payment_required":
          clearSettings(["voiceName"])
          break
        case "error_upload_pdf":
          setTabUrl(errInfo.tabId, config.pdfViewerUrl)
          break
        case "error_file_access":
        case "error_add_permissions":
        case "error_page_unreadable":
        case "error_login_required":
        case "error_wavenet_auth_required":
        case "error_chatgpt":
          //dont report
          break
        default:
          reportError(err)
      }
    }
    else {
      reportError(err);
    }
  }
}

function reportError(err) {
  if (err && err.stack) {
    var details = err.stack;
    if (!details.startsWith(err.name)) details = err.name + ": " + err.message + "\n" + details;
    brapi.storage.local.get("lastUrl")
      .then(({lastUrl}) => reportIssue(lastUrl, details))
      .catch(console.error)
  }
}

function reportIssue(url, comment) {
  var manifest = brapi.runtime.getManifest();
  return getSettings()
    .then(function(settings) {
      if (url) settings.url = url;
      settings.version = manifest.version;
      settings.userAgent = navigator.userAgent;
      return ajaxPost(config.serviceUrl + "/read-aloud/report-issue", {
        url: JSON.stringify(settings),
        comment: comment
      })
    })
}

function authWavenet() {
  createTab("https://cloud.google.com/text-to-speech/#put-text-to-speech-into-action", true)
    .then(function(tab) {
      addRequestListener();
      brapi.tabs.onRemoved.addListener(onTabRemoved);
      return showInstructions();

      function addRequestListener() {
        brapi.webRequest.onBeforeRequest.addListener(onRequest, {
          urls: ["https://cxl-services.appspot.com/proxy*"],
          tabId: tab.id
        })
      }
      function onTabRemoved(tabId) {
        if (tabId == tab.id) {
          brapi.tabs.onRemoved.removeListener(onTabRemoved);
          brapi.webRequest.onBeforeRequest.removeListener(onRequest);
        }
      }
      function onRequest(details) {
        var parser = parseUrl(details.url);
        var qs = parser.search ? parseQueryString(parser.search) : {};
        if (qs.token) {
          updateSettings({gcpToken: qs.token});
          showSuccess();
        }
      }
      function showInstructions() {
        return executeScript({
          tabId: tab.id,
          code: [
            "var elem = document.createElement('DIV')",
            "elem.id = 'ra-notice'",
            "elem.style.position = 'fixed'",
            "elem.style.top = '0'",
            "elem.style.left = '0'",
            "elem.style.right = '0'",
            "elem.style.backgroundColor = 'yellow'",
            "elem.style.padding = '20px'",
            "elem.style.fontSize = 'larger'",
            "elem.style.zIndex = 999000",
            "elem.style.textAlign = 'center'",
            "elem.innerHTML = 'Please click the blue SPEAK-IT button, then check the I-AM-NOT-A-ROBOT checkbox.'",
            "document.body.appendChild(elem)",
            "1"
          ]
          .join(";\n")
        })
      }
      function showSuccess() {
        return executeScript({
          tabId: tab.id,
          code: [
            "var elem = document.getElementById('ra-notice')",
            "elem.style.backgroundColor = '#0d0'",
            "elem.innerHTML = 'Successful, you can now use Google Wavenet voices. You may close this tab.'"
          ]
          .join(";\n")
        })
      }
    })
}

function userGestureActivate() {
  var audio = document.createElement("AUDIO");
  audio.src = "data:audio/wav;base64,UklGRjIAAABXQVZFZm10IBIAAAABAAEAQB8AAEAfAAABAAgAAABmYWN0BAAAAAAAAABkYXRhAAAAAA==";
  audio.play();
}
