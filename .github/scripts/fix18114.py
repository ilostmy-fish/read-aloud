from pathlib import Path
import json


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'{label} replacement target not found')
    return text.replace(old, new, 1)


# Generic Firefox page highlighter --------------------------------------------
page = Path('js/firefox-page.js')
text = page.read_text()

old = '''    const boundaryMatches = boundary && boundary.text === text && boundary.charLength > 0
    const boundaryKey = boundaryMatches ? boundary.charIndex + ":" + boundary.charLength : "chunk"
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

    if (sourceIndex == null) sourceIndex = firstMappedValue(mapping.chunkToSource)
'''
new = '''    const boundaryMatches = boundary && boundary.text === text && boundary.charLength > 0
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
'''
text = replace_once(text, old, new, 'generic sentence mode')

old = '''    highlightedElement = elem
    highlightedRange = boundaryMatches && range ? range : null
    pendingSelectionElement = null
'''
new = '''    highlightedElement = elem
    highlightedRange = (boundaryMatches || sentenceLevel) && range ? range : null
    pendingSelectionElement = null
'''
text = replace_once(text, old, new, 'generic highlightedRange')

old = '''  function firstMappedValue(mapping) {
    for (const value of mapping) if (value != null) return value
    return null
  }

  function rangeForSourceToken(sourceIndex) {
'''
new = '''  function firstMappedValue(mapping) {
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
'''
text = replace_once(text, old, new, 'generic span helpers')
page.write_text(text)


# ChatGPT highlighter ----------------------------------------------------------
chat = Path('js/firefox-chatgpt.js')
text = chat.read_text()

old = '''    const currentIndex = Number(info.speech.position && info.speech.position.index)
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
'''
new = '''    const currentIndex = Number(info.speech.position && info.speech.position.index)
    const text = info.speech.texts[currentIndex]
    const boundary = info.boundary
    const boundaryMatches = boundary && boundary.text === text && boundary.charLength > 0
    const sentenceLevel = !boundaryMatches && (info.speech.engine === 'Piper' || info.speech.engine === 'Supertonic')

    let sourceIndex = null
    let sourceEndIndex = null
    if (boundaryMatches) {
      const chunkTokenIndex = findTokenAtChar(mapping.chunkTokens, boundary.charIndex)
      sourceIndex = mappedTokenNear(mapping.chunkToSource, chunkTokenIndex)
    }
    else if (sentenceLevel) {
      const span = mappedSourceSpan(mapping.chunkToSource)
      if (span) {
        sourceIndex = span.start
        sourceEndIndex = span.end
      }
    }
    if (sourceIndex == null) sourceIndex = firstMappedValue(mapping.chunkToSource)
    if (sourceIndex == null) {
      hideHighlight()
      return
    }
    if (sourceEndIndex == null) sourceEndIndex = sourceIndex

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

    const endTurn = sentenceLevel ? findTurnForSourceToken(sourceEndIndex) : turn
    const range = sentenceLevel && endTurn && endTurn.key === turn.key
      ? rangeForTurnSourceSpan(turn, sourceIndex, sourceEndIndex, message)
      : rangeForTurnSourceToken(turn, sourceIndex, message)
    if (!range) {
      showElementHighlight(message)
      return
    }

    const elem = findReadableBlock(range.startContainer.parentElement, message) || message
    showRangeHighlight(range, elem)
'''
text = replace_once(text, old, new, 'ChatGPT sentence mode')

old = '''  function rangeForTurnSourceToken(turn, sourceIndex, message) {
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
'''
new = '''  function rangeForTurnSourceSpan(turn, startSourceIndex, endSourceIndex, message) {
    const startLocalIndex = startSourceIndex - turn.sourceTokenStart
    const endLocalIndex = endSourceIndex - turn.sourceTokenStart
    if (startLocalIndex < 0 || endLocalIndex < startLocalIndex) return null

    const cached = getTurnDomAlignment(turn, message)
    if (!cached) return null

    const startDomIndex = mappedValueNear(cached.sourceToDom, startLocalIndex, 12)
    const endDomIndex = mappedValueNear(cached.sourceToDom, endLocalIndex, 12)
    if (startDomIndex == null || endDomIndex == null || startDomIndex > endDomIndex) return null

    const first = cached.domLocal[startDomIndex]
    const last = cached.domLocal[endDomIndex]
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

  function rangeForTurnSourceToken(turn, sourceIndex, message) {
    return rangeForTurnSourceSpan(turn, sourceIndex, sourceIndex, message)
  }
'''
text = replace_once(text, old, new, 'ChatGPT span range')

old = '''  function firstMappedValue(mapping) {
    for (const value of mapping) if (value != null) return value
    return null
  }

  function send(method, ...args) {
'''
new = '''  function firstMappedValue(mapping) {
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

  function send(method, ...args) {
'''
text = replace_once(text, old, new, 'ChatGPT mapped span helper')
chat.write_text(text)


# Version ---------------------------------------------------------------------
manifest = Path('manifest.json')
data = json.loads(manifest.read_text())
if data.get('version') != '1.81.13':
    raise SystemExit(f"unexpected starting version: {data.get('version')!r}")
data['version'] = '1.81.14'
manifest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
