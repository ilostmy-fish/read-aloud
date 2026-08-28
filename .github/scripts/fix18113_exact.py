from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"{label} target not found")
    return text.replace(old, new, 1)


page = Path("js/firefox-chatgpt.js")
text = page.read_text()

old = '''    let sourceOffset = null
    if (turn) sourceOffset = sourceOffsetForTurnToken(turn, tokenIndex)

    return {
      after: record.text.slice(0, 240),
      before: '',
      sectionStart: !!sectionStart,
      sourceOffset,
      chatgptTurnKey: identity.key,
      chatgptTokenIndex: tokenIndex
    }
'''
new = '''    let sourceOffset = null
    let sourceTokenIndex = null
    if (turn) {
      const mapped = sourcePositionForDomToken(turn, message, domTokens, tokenIndex, sectionStart ? 6 : 0)
      if (mapped) {
        sourceOffset = mapped.sourceOffset
        sourceTokenIndex = mapped.localSourceIndex
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
'''
text = replace_once(text, old, new, "getAnchorFromPoint")

old = '''  function sourceOffsetForTurnToken(turn, localTokenIndex) {
    if (!turn) return null
    const start = Math.max(0, turn.sourceTokenStart || 0)
    const end = Math.max(start, turn.sourceTokenEnd || start)
    const sourceIndex = Math.min(Math.max(start + localTokenIndex, start), Math.max(start, end - 1))
    const token = sourceTokens[sourceIndex]
    return token ? token.start : turn.start
  }
'''
new = '''  function sourcePositionForDomToken(turn, message, domTokens, domIndex, maxDistance) {
    const alignment = getTurnDomAlignment(turn, message, domTokens)
    if (!alignment) return null

    const localSourceIndex = mappedValueNear(alignment.domToSource, domIndex, maxDistance || 0)
    if (localSourceIndex == null) return null

    const sourceIndex = turn.sourceTokenStart + localSourceIndex
    const token = sourceTokens[sourceIndex]
    if (!token) return null
    return {localSourceIndex, sourceOffset: token.start}
  }

  function mappedValueNear(mapping, index, maxDistance) {
    if (!mapping || !mapping.length || index == null) return null
    const start = Math.max(0, Math.min(mapping.length - 1, index))
    if (mapping[start] != null) return mapping[start]

    for (let distance = 1; distance <= maxDistance; distance++) {
      if (start + distance < mapping.length && mapping[start + distance] != null) return mapping[start + distance]
      if (start - distance >= 0 && mapping[start - distance] != null) return mapping[start - distance]
    }
    return null
  }
'''
text = replace_once(text, old, new, "DOM-to-source mapper")

marker = '''  function rangeForTurnSourceToken(turn, sourceIndex, message) {
'''
helper = '''  function getTurnDomAlignment(turn, message, domLocal) {
    if (!turn || !message) return null
    const sourceLocal = sourceTokens.slice(turn.sourceTokenStart, turn.sourceTokenEnd)
    domLocal = domLocal || collectDomTokens(message)
    if (!sourceLocal.length || !domLocal.length) return null

    const signature = [
      turn.key,
      turn.start,
      turn.end,
      sourceLocal.length,
      domLocal.length,
      extractMessageText(message).slice(0, 160)
    ].join(':')

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

'''
text = replace_once(text, marker, helper + marker, "shared turn alignment")

old = '''    const sourceLocal = sourceTokens.slice(turn.sourceTokenStart, turn.sourceTokenEnd)
    const domLocal = collectDomTokens(message)
    if (!sourceLocal.length || !domLocal.length) return null

    const signature = turn.key + ':' + extractMessageText(message).slice(0, 160) + ':' + domLocal.length
    let cached = domMapCache.get(turn.key)
    if (!cached || cached.signature !== signature) {
      cached = {signature, map: alignTokenLists(sourceLocal, domLocal, 100).aToB, domLocal}
      domMapCache.set(turn.key, cached)
    }

    let domIndex = cached.map[localIndex]
    if (domIndex == null) {
      for (let distance = 1; distance < Math.min(cached.map.length, 24); distance++) {
        if (localIndex + distance < cached.map.length && cached.map[localIndex + distance] != null) {
          domIndex = cached.map[localIndex + distance]
          break
        }
        if (localIndex - distance >= 0 && cached.map[localIndex - distance] != null) {
          domIndex = cached.map[localIndex - distance]
          break
        }
      }
    }
'''
new = '''    const cached = getTurnDomAlignment(turn, message)
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
'''
text = replace_once(text, old, new, "source-to-DOM highlighter")
page.write_text(text)

bg = Path("js/firefox-chatgpt-background.js")
text = bg.read_text()
old = '''    if (anchor.chatgptTurnKey) {
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
'''
new = '''    if (anchor.chatgptTurnKey && anchor.chatgptSourceTokenIndex != null) {
      const turn = session.chatgptSnapshot.turns.find(item => item.key === anchor.chatgptTurnKey)
      const requestedIndex = Number(anchor.chatgptSourceTokenIndex)
      if (turn && Number.isFinite(requestedIndex)) {
        const turnText = session.fullText.slice(turn.start, turn.end)
        const tokens = tokenize(turnText)
        if (tokens.length) {
          const tokenIndex = Math.max(0, Math.min(tokens.length - 1, Math.round(requestedIndex)))
          return turn.start + tokens[tokenIndex].start
        }
        return turn.start
      }
    }

    const direct = Number(anchor.sourceOffset)
'''
text = replace_once(text, old, new, "background turn resolver")
bg.write_text(text)

manifest = Path("manifest.json")
text = manifest.read_text()
if '"version": "1.81.12"' not in text:
    raise SystemExit("manifest is not 1.81.12")
manifest.write_text(text.replace('"version": "1.81.12"', '"version": "1.81.13"', 1))
