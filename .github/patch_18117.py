from pathlib import Path
import json


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"{label}: target not found")
    p.write_text(text.replace(old, new, 1))


def remove_once(path, block, label):
    replace_once(path, block, "", label)


remove_once(
    "popup.html",
    '''  <div id="rate-control" aria-label="Speech speed">\n    <span class="rate-label">Speed</span>\n    <button id="decrease-rate" type="button" aria-label="Decrease speed by 1">−</button>\n    <input id="popup-rate-input" type="text" inputmode="decimal" aria-label="Speech speed multiplier" autocomplete="off" spellcheck="false" />\n    <button id="increase-rate" type="button" aria-label="Increase speed by 1">+</button>\n  </div>\n''',
    "remove browser popup rate controls",
)

remove_once(
    "js/popup.js",
    '''  $("#decrease-rate").click(adjustPopupRate.bind(null, -1));\n  $("#increase-rate").click(adjustPopupRate.bind(null, +1));\n  $("#popup-rate-input")\n    .on("input", onPopupRateInput)\n    .on("change", commitPopupRateInput)\n    .on("keydown", function(event) {\n      if (event.key == "Enter") {\n        event.preventDefault()\n        commitPopupRateInput.call(this)\n        this.select()\n      }\n    });\n''',
    "remove browser popup rate bindings",
)

remove_once(
    "js/popup.js",
    '''    if (!$("#popup-rate-input").is(":focus")) {\n      $("#popup-rate-input").val(formatPopupRate(settings.rate != null ? settings.rate : defaults.rate))\n    }\n\n''',
    "remove browser popup rate refresh",
)

remove_once(
    "js/popup.js",
    '''function adjustPopupRate(delta) {\n  const input = $("#popup-rate-input")\n  const current = Number(input.val().trim())\n  if (Number.isFinite(current)) {\n    applyPopupRate(current + delta)\n  }\n  else {\n    getSettings(["rate"])\n      .then(settings => applyPopupRate((settings.rate != null ? settings.rate : defaults.rate) + delta))\n      .catch(handleError)\n  }\n}\n\nfunction onPopupRateInput() {\n  const value = Number($(this).val().trim())\n  if (Number.isFinite(value) && value >= .1 && value <= 10) {\n    bgPageInvoke("setPopupRate", [value]).catch(handleError)\n  }\n}\n\nfunction commitPopupRateInput() {\n  const value = Number($(this).val().trim())\n  applyPopupRate(Number.isFinite(value) ? value : 1)\n}\n\nfunction applyPopupRate(value) {\n  const rate = normalizePopupRate(value)\n  $("#popup-rate-input").val(formatPopupRate(rate))\n  return bgPageInvoke("setPopupRate", [rate]).catch(handleError)\n}\n\nfunction normalizePopupRate(value) {\n  const number = Number(value)\n  const clamped = Math.min(10, Math.max(.1, Number.isFinite(number) ? number : 1))\n  return Math.round(clamped * 1000000) / 1000000\n}\n\nfunction formatPopupRate(value) {\n  return String(normalizePopupRate(value))\n}\n\n''',
    "remove browser popup rate functions",
)

remove_once(
    "css/popup.css",
    '''#rate-control {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: .3rem;\n  margin: -4px 15px 12px;\n  font-size: .875rem;\n}\n#rate-control .rate-label {\n  margin-right: .2rem;\n  color: #666;\n}\n#rate-control button,\n#popup-rate-input {\n  box-sizing: border-box;\n  height: 28px;\n  border: 1px solid #c8c8c8;\n  background: #f8f9fa;\n  color: #212529;\n}\n#rate-control button {\n  width: 30px;\n  padding: 0;\n  border-radius: 5px;\n  cursor: pointer;\n  font-size: 1rem;\n  line-height: 1;\n}\n#rate-control button:hover {\n  background: #e2e6ea;\n}\n#popup-rate-input {\n  width: 74px;\n  padding: 2px 6px;\n  border-radius: 4px;\n  text-align: center;\n  font: inherit;\n}\n.dark-mode #rate-control .rate-label {\n  color: #bbb;\n}\n.dark-mode #rate-control button,\n.dark-mode #popup-rate-input {\n  background: #3e3e3e;\n  color: #ddd;\n  border-color: #666;\n}\n\n''',
    "remove browser popup rate styles",
)

replace_once(
    "js/firefox-page.js",
    '''  let statusNode = null\n  let highlight = null\n''',
    '''  let statusNode = null\n  let rateInput = null\n  let highlight = null\n''',
    "controller rate input state",
)

replace_once(
    "js/firefox-page.js",
    '''  window.addEventListener("scroll", refreshHighlightRect, {passive: true})\n  window.addEventListener("resize", refreshHighlightRect, {passive: true})\n\n''',
    '''  window.addEventListener("scroll", refreshHighlightRect, {passive: true})\n  window.addEventListener("resize", refreshHighlightRect, {passive: true})\n\n  if (api.storage && api.storage.onChanged) {\n    api.storage.onChanged.addListener((changes, areaName) => {\n      if (areaName !== "local" || !changes.rate || !rateInput || !rateInput.isConnected) return\n      if (shadow && shadow.activeElement === rateInput) return\n      rateInput.value = formatReadAloudRate(changes.rate.newValue == null ? 1 : changes.rate.newValue)\n    })\n  }\n\n''',
    "controller rate storage sync",
)

replace_once(
    "js/firefox-page.js",
    '''      button:hover { background: rgba(255, 255, 255, .22); }\n      button:disabled { cursor: default; opacity: .55; }\n      .status { min-width: 58px; text-align: center; user-select: none; }\n''',
    '''      button:hover { background: rgba(255, 255, 255, .22); }\n      button:disabled { cursor: default; opacity: .55; }\n      .status { min-width: 58px; text-align: center; user-select: none; }\n      .rate-control {\n        display: flex;\n        align-items: center;\n        gap: 5px;\n        margin-left: 2px;\n      }\n      .rate-label {\n        color: rgba(255, 255, 255, .78);\n        user-select: none;\n      }\n      .rate-button {\n        width: 28px;\n        font-size: 17px;\n      }\n      .rate-input {\n        box-sizing: border-box;\n        width: 62px;\n        height: 30px;\n        border: 1px solid rgba(255, 255, 255, .22);\n        border-radius: 7px;\n        outline: none;\n        background: rgba(255, 255, 255, .09);\n        color: white;\n        text-align: center;\n        font: 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;\n      }\n      .rate-input:focus {\n        border-color: rgba(255, 255, 255, .55);\n        background: rgba(255, 255, 255, .14);\n      }\n''',
    "controller rate styles",
)

replace_once(
    "js/firefox-page.js",
    '''    statusNode = document.createElement("span")\n    statusNode.className = "status"\n    statusNode.textContent = "Reading"\n\n    panel.append(playButton, stopButton, statusNode)\n    shadow.append(style, panel)\n    document.documentElement.appendChild(host)\n    ensureHighlight()\n  }\n\n  function ensureHighlight() {\n''',
    '''    statusNode = document.createElement("span")\n    statusNode.className = "status"\n    statusNode.textContent = "Reading"\n\n    const rateControl = document.createElement("span")\n    rateControl.className = "rate-control"\n\n    const rateLabel = document.createElement("span")\n    rateLabel.className = "rate-label"\n    rateLabel.textContent = "Speed"\n\n    const decreaseRateButton = document.createElement("button")\n    decreaseRateButton.type = "button"\n    decreaseRateButton.className = "rate-button"\n    decreaseRateButton.title = "Decrease speed by 0.25"\n    decreaseRateButton.setAttribute("aria-label", "Decrease speech speed by 0.25")\n    decreaseRateButton.textContent = "−"\n    decreaseRateButton.addEventListener("click", event => {\n      event.preventDefault()\n      event.stopPropagation()\n      adjustReadAloudRate(-0.25)\n    })\n\n    rateInput = document.createElement("input")\n    rateInput.type = "text"\n    rateInput.inputMode = "decimal"\n    rateInput.className = "rate-input"\n    rateInput.title = "Speech speed multiplier"\n    rateInput.setAttribute("aria-label", "Speech speed multiplier")\n    rateInput.autocomplete = "off"\n    rateInput.spellcheck = false\n    rateInput.addEventListener("input", onReadAloudRateInput)\n    rateInput.addEventListener("change", commitReadAloudRateInput)\n    rateInput.addEventListener("keydown", event => {\n      if (event.key === "Enter") {\n        event.preventDefault()\n        commitReadAloudRateInput()\n        rateInput.select()\n      }\n    })\n\n    const increaseRateButton = document.createElement("button")\n    increaseRateButton.type = "button"\n    increaseRateButton.className = "rate-button"\n    increaseRateButton.title = "Increase speed by 0.25"\n    increaseRateButton.setAttribute("aria-label", "Increase speech speed by 0.25")\n    increaseRateButton.textContent = "+"\n    increaseRateButton.addEventListener("click", event => {\n      event.preventDefault()\n      event.stopPropagation()\n      adjustReadAloudRate(0.25)\n    })\n\n    rateControl.append(rateLabel, decreaseRateButton, rateInput, increaseRateButton)\n    panel.append(playButton, stopButton, statusNode, rateControl)\n    shadow.append(style, panel)\n    document.documentElement.appendChild(host)\n    loadControllerRate()\n    ensureHighlight()\n  }\n\n  function loadControllerRate() {\n    return api.storage.local.get("rate")\n      .then(settings => {\n        if (rateInput && (!shadow || shadow.activeElement !== rateInput)) {\n          rateInput.value = formatReadAloudRate(settings.rate == null ? 1 : settings.rate)\n        }\n      })\n      .catch(() => {})\n  }\n\n  function adjustReadAloudRate(delta) {\n    if (!rateInput) return\n    const current = Number(rateInput.value.trim())\n    if (Number.isFinite(current)) {\n      applyReadAloudRate(current + delta)\n      return\n    }\n    api.storage.local.get("rate")\n      .then(settings => applyReadAloudRate((settings.rate == null ? 1 : Number(settings.rate)) + delta))\n      .catch(() => {})\n  }\n\n  function onReadAloudRateInput() {\n    if (!rateInput) return\n    const value = Number(rateInput.value.trim())\n    if (Number.isFinite(value) && value >= .1 && value <= 10) {\n      send("setReadAloudRate", value).catch(() => {})\n    }\n  }\n\n  function commitReadAloudRateInput() {\n    if (!rateInput) return\n    const value = Number(rateInput.value.trim())\n    applyReadAloudRate(Number.isFinite(value) ? value : 1)\n  }\n\n  function applyReadAloudRate(value) {\n    if (!rateInput) return\n    const rate = normalizeReadAloudRate(value)\n    rateInput.value = formatReadAloudRate(rate)\n    send("setReadAloudRate", rate).catch(() => {})\n  }\n\n  function normalizeReadAloudRate(value) {\n    const number = Number(value)\n    const clamped = Math.min(10, Math.max(.1, Number.isFinite(number) ? number : 1))\n    return Math.round(clamped * 1000000) / 1000000\n  }\n\n  function formatReadAloudRate(value) {\n    return String(normalizeReadAloudRate(value))\n  }\n\n  function ensureHighlight() {\n''',
    "controller rate controls",
)

replace_once(
    "js/firefox-page.js",
    '''    host = shadow = playButton = stopButton = statusNode = highlight = null\n''',
    '''    host = shadow = playButton = stopButton = statusNode = rateInput = highlight = null\n''',
    "controller rate cleanup",
)

fixes = Path("js/firefox-fixes.js")
text = fixes.read_text()
replacements = {
    "popupRateRestartTimer": "rateRestartTimer",
    "latestPopupRate": "latestReadAloudRate",
    "POPUP_RATE_RESTART_DELAY": "RATE_RESTART_DELAY",
    "handlers.setPopupRate": "handlers.setReadAloudRate",
    "normalizePopupRate": "normalizeReadAloudRate",
}
for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f"firefox-fixes rename missing: {old}")
    text = text.replace(old, new)
fixes.write_text(text)

manifest = Path("manifest.json")
data = json.loads(manifest.read_text())
if data.get("version") != "1.81.16":
    raise SystemExit(f"expected 1.81.16, found {data.get('version')}")
data["version"] = "1.81.17"
manifest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
