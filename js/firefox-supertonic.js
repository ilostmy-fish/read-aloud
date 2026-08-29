;(function() {
  if (typeof supertonicHost == "undefined" || typeof handlers == "undefined") return

  const SERVICE_URL = "https://supertonic.ttstool.com/"
  const READY_TIMEOUT = 30000
  const originalServiceReady = handlers.supertonicServiceReady
  const readyWaiters = new Set()
  let serviceTab = null

  handlers.supertonicServiceReady = function() {
    if (originalServiceReady) originalServiceReady.apply(this, arguments)

    const tab = this.sender && this.sender.tab
    if (!tab) return
    serviceTab = tab

    for (const waiter of Array.from(readyWaiters)) {
      if (waiter.tabId == null || waiter.tabId === tab.id) {
        clearTimeout(waiter.timer)
        readyWaiters.delete(waiter)
        waiter.resolve(tab)
      }
    }
  }

  supertonicHost.ready = async function({requestFocus} = {}) {
    requestFocus = !!requestFocus
    if (requestFocus) closePopupViews()

    if (serviceTab) {
      try {
        supertonicHost.setTab(serviceTab)
        const status = await supertonicHost.sendRequest("areYouThere")
        if (status !== true) throw new Error("Supertonic host is unavailable")
        if (requestFocus) await showHostTab(serviceTab)
        else await hideHostTab(serviceTab)
        return
      }
      catch (err) {
        serviceTab = null
        supertonicHost.setTab(null)
      }
    }

    const waiter = createReadyWaiter()
    let createdTab
    try {
      createdTab = await brapi.tabs.create({
        url: SERVICE_URL,
        pinned: false,
        active: requestFocus
      })
      waiter.tabId = createdTab.id

      if (!requestFocus) await hideHostTab(createdTab)

      const readyTab = await waiter.promise
      serviceTab = readyTab
      if (requestFocus) await showHostTab(readyTab)
      else await hideHostTab(readyTab)
    }
    catch (err) {
      cancelReadyWaiter(waiter)
      throw err
    }
  }

  async function hideHostTab(tab) {
    if (!tab || tab.id == null) return

    let current = await brapi.tabs.get(tab.id)
    if (current.pinned) current = await brapi.tabs.update(tab.id, {pinned: false})
    if (current.active) return
    await brapi.tabs.hide(tab.id)
  }

  async function showHostTab(tab) {
    if (!tab || tab.id == null) return

    await brapi.tabs.show(tab.id)
    const current = await brapi.tabs.get(tab.id)
    await Promise.all([
      brapi.windows.update(current.windowId, {focused: true}),
      brapi.tabs.update(current.id, {active: true, pinned: false})
    ])
  }

  function closePopupViews() {
    const windows = brapi.extension.getViews({type: "popup"})
    for (const w of windows) w.close()
  }

  function createReadyWaiter() {
    let resolve
    let reject
    const waiter = {
      tabId: null,
      promise: new Promise((fulfill, fail) => {
        resolve = fulfill
        reject = fail
      }),
      resolve: null,
      reject: null,
      timer: null
    }
    waiter.resolve = resolve
    waiter.reject = reject
    waiter.timer = setTimeout(() => {
      readyWaiters.delete(waiter)
      reject(new Error("Timed out waiting for the Supertonic service"))
    }, READY_TIMEOUT)
    readyWaiters.add(waiter)
    return waiter
  }

  function cancelReadyWaiter(waiter) {
    if (!waiter || !readyWaiters.has(waiter)) return
    clearTimeout(waiter.timer)
    readyWaiters.delete(waiter)
  }
})()
