var firefoxReadAloudBoundary = null

;(function() {
  if (typeof speechSynthesis == "undefined" || typeof SpeechSynthesisUtterance == "undefined") return
  if (!browserTtsEngine || !handlers || !handlers.getPagePlaybackState) return

  let utter = null

  browserTtsEngine.speak = function(text, options, onEvent) {
    utter = new SpeechSynthesisUtterance()
    utter.text = text
    utter.voice = options.voice
    if (options.lang) utter.lang = options.lang
    if (options.pitch) utter.pitch = options.pitch
    if (options.rate) utter.rate = options.rate
    if (options.volume) utter.volume = options.volume

    firefoxReadAloudBoundary = makeBoundary(text, 0, "start")

    utter.onstart = function() {
      firefoxReadAloudBoundary = makeBoundary(text, 0, "start")
      onEvent({type: "start", charIndex: 0})
    }
    utter.onboundary = function(event) {
      if (typeof event.charIndex != "number") return
      firefoxReadAloudBoundary = makeBoundary(text, event.charIndex, event.name || "word")
    }
    utter.onend = function() {
      firefoxReadAloudBoundary = makeBoundary(text, text.length, "end")
      onEvent({type: "end", charIndex: text.length})
    }
    utter.onerror = function(event) {
      firefoxReadAloudBoundary = null
      if (event.error == "canceled" || event.error == "interrupted") return
      onEvent({type: "error", error: new Error(event.error)})
    }

    speechSynthesis.cancel()
    speechSynthesis.speak(utter)
  }

  browserTtsEngine.stop = function() {
    if (utter) utter.onend = null
    utter = null
    firefoxReadAloudBoundary = null
    speechSynthesis.cancel()
  }

  const getPagePlaybackState = handlers.getPagePlaybackState
  handlers.getPagePlaybackState = async function() {
    const result = await getPagePlaybackState.apply(this, arguments)
    if (result && result.active) result.boundary = firefoxReadAloudBoundary
    return result
  }

  function makeBoundary(text, charIndex, name) {
    let start = Math.max(0, Math.min(charIndex || 0, text.length))
    while (start < text.length && /\s/.test(text[start])) start++
    let end = start
    while (end < text.length && !/\s/.test(text[end])) end++
    return {
      text: text,
      charIndex: start,
      charLength: Math.max(0, end - start),
      name: name
    }
  }
})()
