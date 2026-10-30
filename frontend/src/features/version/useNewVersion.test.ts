import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNewVersion } from './useNewVersion'

function serveBuilds(...builds: string[]) {
  const fetchMock = vi.fn(() => {
    const build = builds.length > 1 ? builds.shift() : builds[0]
    return Promise.resolve(new Response(JSON.stringify({ build })))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Lets the first check and the next one (after the polling interval) finish. */
async function nextCheck() {
  await act(() => vi.advanceTimersByTimeAsync(5_000))
}

describe('useNewVersion', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('reloads the page when a new build is deployed', async () => {
    serveBuilds('a', 'a', 'b')
    const reload = vi.fn()
    renderHook(() => useNewVersion({ enabled: true, reload }))

    await nextCheck()
    expect(reload).not.toHaveBeenCalled()
    await nextCheck()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('asks instead of reloading while the user is typing', async () => {
    serveBuilds('a', 'b')
    document.body.innerHTML = '<textarea id="message">half a question</textarea>'
    const reload = vi.fn()
    const { result } = renderHook(() => useNewVersion({ enabled: true, reload }))

    await nextCheck()
    expect(reload).not.toHaveBeenCalled()
    expect(result.current).toBe(true)
  })

  it('ignores a server that is down or not built', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    const reload = vi.fn()
    const { result } = renderHook(() => useNewVersion({ enabled: true, reload }))

    await nextCheck()
    expect(reload).not.toHaveBeenCalled()
    expect(result.current).toBe(false)
  })

  it('does nothing outside production builds', async () => {
    const fetchMock = serveBuilds('a', 'b')
    renderHook(() => useNewVersion({ enabled: false }))

    await nextCheck()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
