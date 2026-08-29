from pathlib import Path
import json


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"{label}: target not found")
    p.write_text(text.replace(old, new, 1))


replace_once(
    "popup.html",
    '''  </div>\n  <div id="highlight">\n''',
    '''  </div>\n  <div id="rate-control" aria-label="Speech speed">\n    <span class="rate-label">Speed</span>\n    <button id="decrease-rate" type="button" aria-label="Decrease speed by 1">−</button>\n    <input id="popup-rate-input" type="text" inputmode="decimal" aria-label="Speech speed multiplier" autocomplete="off" spellcheck="false" />\n    <button id="increase-rate" type="button" aria-label="Increase speed by 1">+</button>\n  </div>\n  <div id="highlight">\n''',
    "popup rate controls",
)

replace_once(
    "js/popup.js",
    '''  $("#toggle-dark-mode").click(toggleDarkMode);\n\n  updateButtons()\n''',
    '''  $("#toggle-dark-mode").click(toggleDarkMode);\n  $("#decrease-rate").click(adjustPopupRate.bind(null, -1));\n  $("#increase-rate").click(adjustPopupRate.bind(null, +1));\n  $("#popup-rate-input")\n    .on("input", onPopupRateInput)\n    .on("change", commitPopupRateInput)\n    .on("keydown", function(event) {\n      if (event.key == "Enter") {\n        event.preventDefault()\n        commitPopupRateInput.call(this)\n        this.select()\n      }\n    });\n\n  updateButtons()\n''',
    "popup rate bindings",
)

replace_once(
    "js/popup.js",
    '''    $("#btnStop").toggle(state == "PAUSED" || state == "PLAYING" || state == "LOADING");\n    $("#btnForward, #btnRewind").toggle(state == "PLAYING" || state == "PAUSED");\n\n    if (showHighlighting''',
    '''    $("#btnStop").toggle(state == "PAUSED" || state == "PLAYING" || state == "LOADING");\n    $("#btnForward, #btnRewind").toggle(state == "PLAYING" || state == "PAUSED");\n    if (!$("#popup-rate-input").is(":focus")) {\n      $("#popup-rate-input").val(formatPopupRate(settings.rate != null ? settings.rate : defaults.rate))\n    }\n\n    if (showHighlighting''',
    "popup rate display refresh",
)

replace_once(
    "js/popup.js",
    '''function changeFontSize(delta) {\n''',
    '''function adjustPopupRate(delta) {\n  const input = $("#popup-rate-input")\n  const current = Number(input.val().trim())\n  if (Number.isFinite(current)) {\n    applyPopupRate(current + delta)\n  }\n  else {\n    getSettings(["rate"])\n      .then(settings => applyPopupRate((settings.rate != null ? settings.rate : defaults.rate) + delta))\n      .catch(handleError)\n  }\n}\n\nfunction onPopupRateInput() {\n  const value = Number($(this).val().trim())\n  if (Number.isFinite(value) && value >= .1 && value <= 10) {\n    bgPageInvoke("setPopupRate", [value]).catch(handleError)\n  }\n}\n\nfunction commitPopupRateInput() {\n  const value = Number($(this).val().trim())\n  applyPopupRate(Number.isFinite(value) ? value : 1)\n}\n\nfunction applyPopupRate(value) {\n  const rate = normalizePopupRate(value)\n  $("#popup-rate-input").val(formatPopupRate(rate))\n  return bgPageInvoke("setPopupRate", [rate]).catch(handleError)\n}\n\nfunction normalizePopupRate(value) {\n  const number = Number(value)\n  const clamped = Math.min(10, Math.max(.1, Number.isFinite(number) ? number : 1))\n  return Math.round(clamped * 1000000) / 1000000\n}\n\nfunction formatPopupRate(value) {\n  return String(normalizePopupRate(value))\n}\n\nfunction changeFontSize(delta) {\n''',
    "popup rate functions",
)

replace_once(
    "css/popup.css",
    '''body.is-popup #highlight {\n''',
    '''#rate-control {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: .3rem;\n  margin: -4px 15px 12px;\n  font-size: .875rem;\n}\n#rate-control .rate-label {\n  margin-right: .2rem;\n  color: #666;\n}\n#rate-control button,\n#popup-rate-input {\n  box-sizing: border-box;\n  height: 28px;\n  border: 1px solid #c8c8c8;\n  background: #f8f9fa;\n  color: #212529;\n}\n#rate-control button {\n  width: 30px;\n  padding: 0;\n  border-radius: 5px;\n  cursor: pointer;\n  font-size: 1rem;\n  line-height: 1;\n}\n#rate-control button:hover {\n  background: #e2e6ea;\n}\n#popup-rate-input {\n  width: 74px;\n  padding: 2px 6px;\n  border-radius: 4px;\n  text-align: center;\n  font: inherit;\n}\n.dark-mode #rate-control .rate-label {\n  color: #bbb;\n}\n.dark-mode #rate-control button,\n.dark-mode #popup-rate-input {\n  background: #3e3e3e;\n  color: #ddd;\n  border-color: #666;\n}\n\nbody.is-popup #highlight {\n''',
    "popup rate styles",
)

replace_once(
    "js/firefox-fixes.js",
    '''  let readSessionSerial = 0\n''',
    '''  let readSessionSerial = 0\n  let popupRateRestartTimer = null\n  let latestPopupRate = null\n  const POPUP_RATE_RESTART_DELAY = 600\n''',
    "rate debounce state",
)

replace_once(
    "js/firefox-fixes.js",
    '''  restartReadSession = async function(tabId, offset, autoplay) {\n''',
    '''  handlers.setPopupRate = function(rate) {\n    const normalizedRate = normalizePopupRate(rate)\n    latestPopupRate = normalizedRate\n\n    if (popupRateRestartTimer) clearTimeout(popupRateRestartTimer)\n    popupRateRestartTimer = setTimeout(function() {\n      popupRateRestartTimer = null\n      Promise.resolve(updateSettings({rate: latestPopupRate}))\n        .then(restartCurrentSentenceWithRate)\n        .catch(handleError)\n    }, POPUP_RATE_RESTART_DELAY)\n\n    return updateSettings({rate: normalizedRate}).then(function() {\n      return normalizedRate\n    })\n  }\n\n  restartReadSession = async function(tabId, offset, autoplay) {\n''',
    "rate IPC handler",
)

replace_once(
    "js/firefox-fixes.js",
    '''  function resetPageMapping(tabId) {\n''',
    '''  async function restartCurrentSentenceWithRate() {\n    const tabId = activeReadTabId\n    const session = tabId != null ? readSessions[tabId] : null\n    if (!session || !activeDoc || tabId !== activeReadTabId) return\n\n    const state = await getPlaybackState()\n    if (state == "STOPPED") return\n    const autoplay = !(session.paused || state == "PAUSED")\n    const offset = await getCurrentSentenceSessionOffset(session)\n    return restartReadSession(tabId, offset, autoplay)\n  }\n\n  async function getCurrentSentenceSessionOffset(session) {\n    const speech = await getActiveSpeech()\n    if (!speech || !session.fullText) return session.offset || 0\n\n    const info = speech.getInfo()\n    if (!info || !Array.isArray(info.texts) || !info.texts.length) return session.offset || 0\n\n    const position = info.position || {}\n    let index = Number(position.index)\n    if (!Number.isInteger(index)) index = 0\n    index = Math.max(0, Math.min(info.texts.length - 1, index))\n\n    let speechPrefix = info.texts.slice(0, index).join("")\n    if (info.engine != "Piper" && info.engine != "Supertonic") {\n      const currentText = String(info.texts[index] || "")\n      let sentenceStart = 0\n      if (typeof firefoxReadAloudBoundary != "undefined" && firefoxReadAloudBoundary && firefoxReadAloudBoundary.text === currentText) {\n        sentenceStart = findSentenceStart(currentText, Number(firefoxReadAloudBoundary.charIndex) || 0)\n      }\n      speechPrefix += currentText.slice(0, sentenceStart)\n    }\n\n    const tokenOrdinal = countRateTokens(speechPrefix)\n    if (tokenOrdinal <= 0) return session.offset || 0\n\n    const remaining = session.fullText.slice(session.offset || 0)\n    const sourceTokens = getRateTokenOffsets(remaining)\n    if (tokenOrdinal >= sourceTokens.length) return session.offset || 0\n    return (session.offset || 0) + sourceTokens[tokenOrdinal].start\n  }\n\n  function findSentenceStart(text, charIndex) {\n    const limit = Math.max(0, Math.min(Number(charIndex) || 0, text.length))\n    let start = 0\n    const re = /[.!?]+[\\s\\u200b]+/g\n    let match\n    while ((match = re.exec(text))) {\n      const end = match.index + match[0].length\n      if (end > limit) break\n      start = end\n    }\n    while (start < text.length && /\\s/.test(text[start])) start++\n    return start\n  }\n\n  function countRateTokens(text) {\n    return getRateTokenOffsets(text).length\n  }\n\n  function getRateTokenOffsets(text) {\n    const tokens = []\n    const value = String(text || "")\n    let re\n    try {\n      re = new RegExp("[\\\\p{L}\\\\p{N}]+(?:['’][\\\\p{L}\\\\p{N}]+)*", "gu")\n    }\n    catch (err) {\n      re = /[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g\n    }\n    let match\n    while ((match = re.exec(value))) tokens.push({start: match.index, end: match.index + match[0].length})\n    return tokens\n  }\n\n  function normalizePopupRate(rate) {\n    const value = Number(rate)\n    if (!Number.isFinite(value)) return 1\n    return Math.round(Math.min(10, Math.max(.1, value)) * 1000000) / 1000000\n  }\n\n  function resetPageMapping(tabId) {\n''',
    "rate restart helpers",
)

manifest = Path("manifest.json")
data = json.loads(manifest.read_text())
if data.get("version") != "1.81.15":
    raise SystemExit(f"expected 1.81.15, found {data.get('version')}")
data["version"] = "1.81.16"
manifest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
