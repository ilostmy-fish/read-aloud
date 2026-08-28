from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"{label} target not found")
    return text.replace(old, new, 1)


page = Path("js/firefox-chatgpt.js")
text = page.read_text()

old = '''    let sourceOffset = null
    let sourceTokenIndex = null
    if (turn) {
      const alignment = getTurnDomAlignment(turn, message, domTokens)
      if (alignment) {
        sourceTokenIndex = alignment.domToSource[tokenIndex]
        if (sourceTokenIndex == null) sourceTokenIndex = mappedTokenNear(alignment.domToSource, tokenIndex, 5)
        if (sourceTokenIndex != null) sourceOffset = sourceOffsetForTurnToken(turn, sourceTokenIndex)
      }
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
'''
text = replace_once(text, old, new, "click mapping")

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
text = replace_once(text, old, new, "source position helper")

old = '''    const signature = turn.key + ':' + extractMessageText(message).slice(0, 160) + ':' + domLocal.length
'''
new = '''    const signature = [
      turn.key,
      turn.start,
      turn.end,
      sourceLocal.length,
      domLocal.length,
      extractMessageText(message).slice(0, 160)
    ].join(':')
'''
text = replace_once(text, old, new, "alignment cache signature")
page.write_text(text)
