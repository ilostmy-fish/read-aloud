from pathlib import Path
import json

root = Path('.')


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'{label}: target not found')
    return text.replace(old, new, 1)


# Generic page highlighter: use one overlay strip per rendered line.
p = root / 'js/firefox-page.js'
text = p.read_text()
old = '''  function ensureHighlight() {
    if (highlight && highlight.isConnected) return
    highlight = document.createElement("div")
    highlight.id = "read-aloud-firefox-highlight"
    Object.assign(highlight.style, {
      position: "fixed",
      display: "none",
      pointerEvents: "none",
      zIndex: "2147483646",
      borderRadius: "4px",
      background: "rgba(255, 213, 79, .28)",
      boxShadow: "0 0 0 2px rgba(255, 193, 7, .58) inset",
      transition: "top .10s ease, left .10s ease, width .10s ease, height .10s ease"
    })
    document.documentElement.appendChild(highlight)
  }
'''
new = '''  function ensureHighlight() {
    if (highlight && highlight.isConnected) return
    highlight = document.createElement("div")
    highlight.id = "read-aloud-firefox-highlight"
    Object.assign(highlight.style, {
      position: "fixed",
      display: "none",
      left: "0",
      top: "0",
      width: "0",
      height: "0",
      pointerEvents: "none",
      zIndex: "2147483646"
    })
    document.documentElement.appendChild(highlight)
  }

  function ensureHighlightParts(count) {
    ensureHighlight()
    while (highlight.children.length < count) {
      const part = document.createElement("div")
      part.className = "read-aloud-firefox-highlight-part"
      Object.assign(part.style, {
        position: "fixed",
        display: "none",
        pointerEvents: "none",
        borderRadius: "4px",
        background: "rgba(255, 213, 79, .28)",
        boxShadow: "0 0 0 2px rgba(255, 193, 7, .58) inset",
        transition: "top .10s ease, left .10s ease, width .10s ease, height .10s ease"
      })
      highlight.appendChild(part)
    }
  }
'''
text = replace_once(text, old, new, 'generic ensureHighlight')

old = '''  function getCurrentHighlightRect() {
    if (highlightedRange) {
      try {
        const rangeRect = highlightedRange.getBoundingClientRect()
        if (rangeRect.width && rangeRect.height) return rangeRect
      }
      catch (err) {}
    }
    if (highlightedElement && highlightedElement.isConnected) return highlightedElement.getBoundingClientRect()
    return null
  }

  function refreshHighlightRect() {
    if (!highlight || !highlightedElement || !highlightedElement.isConnected) return
    const rect = getCurrentHighlightRect()
    if (!rect || !rect.width || !rect.height || rect.bottom < 0 || rect.top > window.innerHeight) {
      highlight.style.display = "none"
      return
    }
    const left = Math.max(0, rect.left - 3)
    const top = Math.max(0, rect.top - 2)
    highlight.style.display = "block"
    highlight.style.left = left + "px"
    highlight.style.top = top + "px"
    highlight.style.width = Math.max(0, Math.min(window.innerWidth - left, rect.width + 6)) + "px"
    highlight.style.height = (rect.height + 4) + "px"
  }
'''
new = '''  function getCurrentHighlightRects() {
    if (highlightedRange) {
      try {
        const rects = mergeHighlightLineRects(Array.from(highlightedRange.getClientRects()))
        if (rects.length) return rects
      }
      catch (err) {}
    }
    if (highlightedElement && highlightedElement.isConnected) {
      const rect = highlightedElement.getBoundingClientRect()
      return rect && rect.width && rect.height ? [rect] : []
    }
    return []
  }

  function mergeHighlightLineRects(rects) {
    const items = rects
      .filter(rect => rect && rect.width > 0 && rect.height > 0)
      .map(rect => ({left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height}))
      .sort((a, b) => a.top - b.top || a.left - b.left)
    const lines = []
    for (const rect of items) {
      const line = lines[lines.length - 1]
      const overlap = line ? Math.min(line.bottom, rect.bottom) - Math.max(line.top, rect.top) : 0
      const sameLine = line && overlap >= Math.min(line.height, rect.height) * .5
      if (sameLine && rect.left <= line.right + 12) {
        line.left = Math.min(line.left, rect.left)
        line.right = Math.max(line.right, rect.right)
        line.top = Math.min(line.top, rect.top)
        line.bottom = Math.max(line.bottom, rect.bottom)
        line.width = line.right - line.left
        line.height = line.bottom - line.top
      }
      else {
        lines.push({...rect})
      }
    }
    return lines
  }

  function refreshHighlightRect() {
    if (!highlight || !highlightedElement || !highlightedElement.isConnected) return
    const rects = getCurrentHighlightRects().filter(rect =>
      rect.right >= 0 && rect.left <= window.innerWidth && rect.bottom >= 0 && rect.top <= window.innerHeight
    )
    if (!rects.length) {
      highlight.style.display = "none"
      return
    }

    ensureHighlightParts(rects.length)
    highlight.style.display = "block"
    const parts = Array.from(highlight.children)
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const rect = rects[i]
      if (!rect) {
        part.style.display = "none"
        continue
      }
      const left = Math.max(0, rect.left - 3)
      const top = Math.max(0, rect.top - 2)
      part.style.display = "block"
      part.style.left = left + "px"
      part.style.top = top + "px"
      part.style.width = Math.max(0, Math.min(window.innerWidth - left, rect.width + 6)) + "px"
      part.style.height = (rect.height + 4) + "px"
    }
  }
'''
text = replace_once(text, old, new, 'generic per-line rendering')

old = '''  function rangeForSourceSpan(startSourceIndex, endSourceIndex) {
    const startDomIndex = nearestMappedDomIndex(startSourceIndex)
    const endDomIndex = nearestMappedDomIndex(endSourceIndex)
    if (startDomIndex == null || endDomIndex == null || startDomIndex > endDomIndex) {
      return rangeForSourceToken(startSourceIndex)
    }
'''
new = '''  function rangeForSourceSpan(startSourceIndex, endSourceIndex) {
    const startDomIndex = mappedDomIndexAtOrAfter(startSourceIndex, 12)
    const endDomIndex = mappedDomIndexAtOrBefore(endSourceIndex, 12)
    if (startDomIndex == null || endDomIndex == null || startDomIndex > endDomIndex) {
      return rangeForSourceToken(startSourceIndex)
    }
'''
text = replace_once(text, old, new, 'generic directional sentence edges')

needle = '''  function nearestMappedDomIndex(sourceIndex) {
    if (!sourceToDom.length) return null
    const start = Math.max(0, Math.min(sourceToDom.length - 1, sourceIndex))
    if (sourceToDom[start] != null) return sourceToDom[start]
    for (let distance = 1; distance < Math.min(sourceToDom.length, 40); distance++) {
      const after = start + distance
      if (after < sourceToDom.length && sourceToDom[after] != null) return sourceToDom[after]
      const before = start - distance
      if (before >= 0 && sourceToDom[before] != null) return sourceToDom[before]
    }
    return null
  }
'''
replacement = needle + '''
  function mappedDomIndexAtOrAfter(sourceIndex, maxDistance) {
    if (!sourceToDom.length) return null
    const start = Math.max(0, Math.min(sourceToDom.length - 1, sourceIndex))
    for (let distance = 0; distance <= maxDistance && start + distance < sourceToDom.length; distance++) {
      const value = sourceToDom[start + distance]
      if (value != null) return value
    }
    return null
  }

  function mappedDomIndexAtOrBefore(sourceIndex, maxDistance) {
    if (!sourceToDom.length) return null
    const start = Math.max(0, Math.min(sourceToDom.length - 1, sourceIndex))
    for (let distance = 0; distance <= maxDistance && start - distance >= 0; distance++) {
      const value = sourceToDom[start - distance]
      if (value != null) return value
    }
    return null
  }
'''
text = replace_once(text, needle, replacement, 'generic directional helpers')
p.write_text(text)


# ChatGPT highlighter: same per-line rendering and directional sentence edges.
p = root / 'js/firefox-chatgpt.js'
text = p.read_text()
old = '''    const startDomIndex = mappedValueNear(cached.sourceToDom, startLocalIndex, 12)
    const endDomIndex = mappedValueNear(cached.sourceToDom, endLocalIndex, 12)
    if (startDomIndex == null || endDomIndex == null || startDomIndex > endDomIndex) return null
'''
new = '''    const startDomIndex = mappedValueAtOrAfter(cached.sourceToDom, startLocalIndex, 12)
    const endDomIndex = mappedValueAtOrBefore(cached.sourceToDom, endLocalIndex, 12)
    if (startDomIndex == null || endDomIndex == null || startDomIndex > endDomIndex) return null
'''
text = replace_once(text, old, new, 'ChatGPT directional sentence edges')

old = '''  function ensureHighlight() {
    if (highlight && highlight.isConnected) return
    highlight = document.createElement('div')
    highlight.id = 'read-aloud-firefox-chatgpt-highlight'
    Object.assign(highlight.style, {
      position: 'fixed',
      display: 'none',
      pointerEvents: 'none',
      zIndex: '2147483646',
      borderRadius: '4px',
      background: 'rgba(255, 213, 79, .28)',
      boxShadow: '0 0 0 2px rgba(255, 193, 7, .58) inset',
      transition: 'top .10s ease, left .10s ease, width .10s ease, height .10s ease'
    })
    document.documentElement.appendChild(highlight)
  }
'''
new = '''  function ensureHighlight() {
    if (highlight && highlight.isConnected) return
    highlight = document.createElement('div')
    highlight.id = 'read-aloud-firefox-chatgpt-highlight'
    Object.assign(highlight.style, {
      position: 'fixed',
      display: 'none',
      left: '0',
      top: '0',
      width: '0',
      height: '0',
      pointerEvents: 'none',
      zIndex: '2147483646'
    })
    document.documentElement.appendChild(highlight)
  }

  function ensureHighlightParts(count) {
    ensureHighlight()
    while (highlight.children.length < count) {
      const part = document.createElement('div')
      part.className = 'read-aloud-firefox-chatgpt-highlight-part'
      Object.assign(part.style, {
        position: 'fixed',
        display: 'none',
        pointerEvents: 'none',
        borderRadius: '4px',
        background: 'rgba(255, 213, 79, .28)',
        boxShadow: '0 0 0 2px rgba(255, 193, 7, .58) inset',
        transition: 'top .10s ease, left .10s ease, width .10s ease, height .10s ease'
      })
      highlight.appendChild(part)
    }
  }
'''
text = replace_once(text, old, new, 'ChatGPT ensureHighlight')

old = '''  function refreshHighlightRect() {
    if (!highlight || !highlight._raElement || !highlight._raElement.isConnected) return
    let rect = null
    if (highlight._raRange) {
      try {
        const rangeRect = highlight._raRange.getBoundingClientRect()
        if (rangeRect.width && rangeRect.height) rect = rangeRect
      }
      catch (err) {}
    }
    if (!rect) rect = highlight._raElement.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) {
      highlight.style.display = 'none'
      return
    }

    const left = Math.max(0, rect.left - 3)
    const top = Math.max(0, rect.top - 2)
    highlight.style.display = 'block'
    highlight.style.left = left + 'px'
    highlight.style.top = top + 'px'
    highlight.style.width = Math.max(0, Math.min(innerWidth - left, rect.width + 6)) + 'px'
    highlight.style.height = rect.height + 4 + 'px'
  }
'''
new = '''  function refreshHighlightRect() {
    if (!highlight || !highlight._raElement || !highlight._raElement.isConnected) return
    let rects = []
    if (highlight._raRange) {
      try {
        rects = mergeHighlightLineRects(Array.from(highlight._raRange.getClientRects()))
      }
      catch (err) {}
    }
    if (!rects.length) {
      const rect = highlight._raElement.getBoundingClientRect()
      if (rect && rect.width && rect.height) rects = [rect]
    }
    rects = rects.filter(rect => rect.right >= 0 && rect.left <= innerWidth && rect.bottom >= 0 && rect.top <= innerHeight)
    if (!rects.length) {
      highlight.style.display = 'none'
      return
    }

    ensureHighlightParts(rects.length)
    highlight.style.display = 'block'
    const parts = Array.from(highlight.children)
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const rect = rects[i]
      if (!rect) {
        part.style.display = 'none'
        continue
      }
      const left = Math.max(0, rect.left - 3)
      const top = Math.max(0, rect.top - 2)
      part.style.display = 'block'
      part.style.left = left + 'px'
      part.style.top = top + 'px'
      part.style.width = Math.max(0, Math.min(innerWidth - left, rect.width + 6)) + 'px'
      part.style.height = rect.height + 4 + 'px'
    }
  }

  function mergeHighlightLineRects(rects) {
    const items = rects
      .filter(rect => rect && rect.width > 0 && rect.height > 0)
      .map(rect => ({left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height}))
      .sort((a, b) => a.top - b.top || a.left - b.left)
    const lines = []
    for (const rect of items) {
      const line = lines[lines.length - 1]
      const overlap = line ? Math.min(line.bottom, rect.bottom) - Math.max(line.top, rect.top) : 0
      const sameLine = line && overlap >= Math.min(line.height, rect.height) * .5
      if (sameLine && rect.left <= line.right + 12) {
        line.left = Math.min(line.left, rect.left)
        line.right = Math.max(line.right, rect.right)
        line.top = Math.min(line.top, rect.top)
        line.bottom = Math.max(line.bottom, rect.bottom)
        line.width = line.right - line.left
        line.height = line.bottom - line.top
      }
      else {
        lines.push({...rect})
      }
    }
    return lines
  }
'''
text = replace_once(text, old, new, 'ChatGPT per-line rendering')

needle = '''  function mappedValueNear(mapping, index, maxDistance) {
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
replacement = needle + '''
  function mappedValueAtOrAfter(mapping, index, maxDistance) {
    if (!mapping || !mapping.length || index == null) return null
    const start = Math.max(0, Math.min(mapping.length - 1, index))
    for (let distance = 0; distance <= maxDistance && start + distance < mapping.length; distance++) {
      const value = mapping[start + distance]
      if (value != null) return value
    }
    return null
  }

  function mappedValueAtOrBefore(mapping, index, maxDistance) {
    if (!mapping || !mapping.length || index == null) return null
    const start = Math.max(0, Math.min(mapping.length - 1, index))
    for (let distance = 0; distance <= maxDistance && start - distance >= 0; distance++) {
      const value = mapping[start - distance]
      if (value != null) return value
    }
    return null
  }
'''
text = replace_once(text, needle, replacement, 'ChatGPT directional helpers')
p.write_text(text)


manifest = root / 'manifest.json'
data = json.loads(manifest.read_text())
if data.get('version') != '1.81.14':
    raise SystemExit(f"unexpected version {data.get('version')}")
data['version'] = '1.81.15'
manifest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
