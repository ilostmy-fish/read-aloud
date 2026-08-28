from pathlib import Path
import json


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'{label} replacement target not found')
    return text.replace(old, new, 1)


page = Path('js/firefox-chatgpt.js')
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
'''
text = replace_once(text, old, new, 'getAnchorFromPoint')

old = '''  function rangeForTurnSourceToken(turn, sourceIndex, message) {
    const localIndex = sourceIndex - turn.sourceTokenStart
    if (localIndex < 0) return null

    const sourceLocal = sourceTokens.slice(turn.sourceTokenStart, turn.sourceTokenEnd)
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
    const token = domIndex != null ? cached.domLocal[domIndex] : null
'''
new = '''  function getTurnDomAlignment(turn, message, domLocal) {
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
'''
text = replace_once(text, old, new, 'rangeForTurnSourceToken')

old = '''  function mappedTokenNear(mapping, index) {
    if (!mapping.length) return null
    const start = Math.max(0, Math.min(mapping.length - 1, index || 0))
    if (mapping[start] != null) return mapping[start]
    for (let distance = 1; distance < Math.min(mapping.length, 16); distance++) {
      if (start + distance < mapping.length && mapping[start + distance] != null) return mapping[start + distance]
      if (start - distance >= 0 && mapping[start - distance] != null) return mapping[start - distance]
    }
    return null
  }
'''
new = '''  function mappedTokenNear(mapping, index, maxDistance) {
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
'''
text = replace_once(text, old, new, 'mappedTokenNear')
page.write_text(text)

bg = Path('js/firefox-chatgpt-background.js')
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
new = '''    if (anchor.chatgptTurnKey) {
      const turn = session.chatgptSnapshot.turns.find(item => item.key === anchor.chatgptTurnKey)
      if (turn) {
        const turnText = session.fullText.slice(turn.start, turn.end)
        const tokens = tokenize(turnText)
        if (tokens.length && anchor.chatgptSourceTokenIndex != null) {
          const value = Number(anchor.chatgptSourceTokenIndex)
          if (Number.isFinite(value)) {
            const tokenIndex = Math.max(0, Math.min(tokens.length - 1, Math.round(value)))
            return turn.start + tokens[tokenIndex].start
          }
        }
      }
    }

    const direct = Number(anchor.sourceOffset)
'''
text = replace_once(text, old, new, 'background anchor')
bg.write_text(text)

manifest = Path('manifest.json')
data = json.loads(manifest.read_text())
if data.get('version') != '1.81.12':
    raise SystemExit(f"unexpected starting manifest version: {data.get('version')!r}")
data['version'] = '1.81.13'
manifest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
