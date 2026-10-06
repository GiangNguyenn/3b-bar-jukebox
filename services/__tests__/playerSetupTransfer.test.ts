/**
 * After Spotify dropped the jukebox's device, the rebuilt player could not
 * take over playback and the jukebox stayed silent until the page was
 * reloaded (2026-10-06, 3B). Three things went wrong:
 *
 * - Player setup's "move playback anyway" never sent the transfer: it checked
 *   Spotify's device list first and gave up because the new device was not
 *   listed yet.
 * - All attempts were spent within about 5 seconds.
 * - A failed transfer did not settle createPlayer(), so auto-recovery could
 *   not retry until the 30s initialization timeout.
 *
 * A second createPlayer() while the first was connecting also registered a
 * second SDK player in the same tab.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SDKLifecycleManager } from '@/services/playerLifecycle/SDKLifecycleManager'
import { transferPlaybackToDevice } from '@/services/deviceManagement'
import { tokenManager } from '@/shared/token/tokenManager'
import type { PlayerEventDispatcher } from '@/services/playerLifecycle/types'

const realFetch = globalThis.fetch
const realNow = Date.now.bind(Date)
const NEW_DEVICE = 'new-device'

let clockOffset = 0

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

const noContent = (): Response => new Response(null, { status: 204 })

/**
 * Fakes the Spotify Web API. The new device is never in the device list.
 * Transfers answer 404 until `acceptTransferAfter` of them have been made;
 * after an accepted transfer, playback state shows the new device.
 */
function fakeSpotify(options: {
  acceptTransferAfter: number
  onTransfer?: () => void
}): { transfers: () => number } {
  let transfers = 0
  let transferred = false
  globalThis.fetch = ((input: string, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.includes('/me/player/devices')) {
      return Promise.resolve(jsonResponse(200, { devices: [] }))
    }
    if (method === 'PUT' && /\/me\/player$/.test(url)) {
      transfers++
      options.onTransfer?.()
      if (transfers > options.acceptTransferAfter) {
        transferred = true
        return Promise.resolve(noContent())
      }
      return Promise.resolve(
        jsonResponse(404, { error: { status: 404, message: 'Not found.' } })
      )
    }
    if (method === 'GET' && url.includes('/me/player')) {
      return Promise.resolve(
        transferred
          ? jsonResponse(200, {
              device: {
                id: NEW_DEVICE,
                name: 'Jukebox Player',
                is_active: true
              }
            })
          : noContent()
      )
    }
    return Promise.resolve(noContent())
  }) as typeof fetch
  return { transfers: () => transfers }
}

interface ManagerInternals {
  playerRef: unknown
  deviceErrorResolver: ((error: Error) => void) | null
  deviceReadyResolver: ((deviceId: string) => void) | null
}

function makeManagerWithPlayer(): {
  manager: SDKLifecycleManager
  internals: ManagerInternals
} {
  const manager = new SDKLifecycleManager({} as PlayerEventDispatcher)
  const internals = manager as unknown as ManagerInternals
  internals.playerRef = { disconnect: () => undefined }
  return { manager, internals }
}

void describe('transferPlaybackToDevice', () => {
  beforeEach(() => {
    clockOffset += 60_000
    mock.method(Date, 'now', () => realNow() + clockOffset)
    mock.method(tokenManager, 'getToken', () => Promise.resolve('token'))
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    mock.restoreAll()
  })

  void it('by default gives up without a transfer when the device is not listed', async () => {
    const spotify = fakeSpotify({ acceptTransferAfter: 0 })

    const ok = await transferPlaybackToDevice(NEW_DEVICE, 1, 0)

    assert.equal(ok, false)
    assert.equal(spotify.transfers(), 0)
  })

  void it('with requireListed false sends the transfer to an unlisted device', async () => {
    const spotify = fakeSpotify({ acceptTransferAfter: 0 })

    const ok = await transferPlaybackToDevice(
      NEW_DEVICE,
      1,
      0,
      true,
      null,
      false
    )

    assert.equal(ok, true)
    assert.equal(spotify.transfers(), 1)
  })
})

void describe('SDKLifecycleManager.handleDeviceReady', () => {
  beforeEach(() => {
    clockOffset += 60_000
    mock.method(Date, 'now', () => realNow() + clockOffset)
    mock.method(tokenManager, 'getToken', () => Promise.resolve('token'))
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    mock.restoreAll()
  })

  void it('keeps transferring until Spotify accepts the new device', async () => {
    const spotify = fakeSpotify({ acceptTransferAfter: 1 })
    const { manager, internals } = makeManagerWithPlayer()
    let resolvedWith: string | null = null
    internals.deviceReadyResolver = (id) => {
      resolvedWith = id
    }
    const statuses: string[] = []

    await manager.handleDeviceReady(
      NEW_DEVICE,
      (status) => statuses.push(status),
      () => undefined
    )

    assert.equal(spotify.transfers(), 2)
    assert.equal(statuses.at(-1), 'ready')
    assert.equal(resolvedWith, NEW_DEVICE)
  })

  void it('settles createPlayer as soon as it gives up', async () => {
    // Each refused transfer moves the clock 20s, so the 30s window runs out
    // after the second one
    const spotify = fakeSpotify({
      acceptTransferAfter: Infinity,
      onTransfer: () => {
        clockOffset += 20_000
      }
    })
    const { manager, internals } = makeManagerWithPlayer()
    let rejectedWith: Error | null = null
    internals.deviceErrorResolver = (error) => {
      rejectedWith = error
    }
    const statuses: string[] = []

    await manager.handleDeviceReady(
      NEW_DEVICE,
      (status) => statuses.push(status),
      () => undefined
    )

    assert.equal(spotify.transfers(), 2)
    assert.equal(statuses.at(-1), 'error')
    assert.ok(rejectedWith, 'createPlayer() should be rejected right away')
    assert.match(
      (rejectedWith as Error).message,
      /could not be moved to it in 2 attempts/
    )
    assert.equal(internals.deviceErrorResolver, null)
  })
})

void describe('SDKLifecycleManager.createPlayer', () => {
  const globals = globalThis as unknown as { window?: unknown }
  const realWindow = globals.window

  afterEach(() => {
    globals.window = realWindow
  })

  void it('refuses a second player while the first is still connecting', async () => {
    let finishConnect: (connected: boolean) => void = () => undefined
    let created = 0
    let disconnected = 0
    class FakePlayer {
      constructor() {
        created++
      }
      addListener(): boolean {
        return true
      }
      connect(): Promise<boolean> {
        return new Promise((done) => {
          finishConnect = done
        })
      }
      disconnect(): void {
        disconnected++
      }
    }
    globals.window = { Spotify: { Player: FakePlayer } }

    const manager = new SDKLifecycleManager({} as PlayerEventDispatcher)
    const noop = (): void => undefined
    const first = manager.createPlayer(noop, noop, noop)
    // Let the first call get past loading the SDK and into connect()
    await new Promise((done) => setTimeout(done, 0))

    await assert.rejects(
      manager.createPlayer(noop, noop, noop),
      /Player already exists/
    )
    assert.equal(created, 1)

    // Clean up: a player destroyed while connecting must not carry on
    manager.destroyPlayer()
    finishConnect(true)
    await assert.rejects(first, /superseded|destroyed/)
    assert.equal(disconnected, 1)
  })
})

void describe('player auto-recovery wiring', () => {
  void it('the admin page mounts auto-recovery once', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'app/[username]/admin/page.tsx'),
      'utf-8'
    )
    assert.equal(page.match(/usePlayerAutoRecovery\(/g)?.length, 1)
  })

  void it('createPlayer shares the creation already in progress', () => {
    const hook = readFileSync(
      resolve(process.cwd(), 'hooks/useSpotifyPlayer.ts'),
      'utf-8'
    )
    assert.match(hook, /if \(inFlightCreate\) \{[\s\S]*?return inFlightCreate/)
  })

  void it('reloads the page as a last resort, rate-limited and never offline', () => {
    const hook = readFileSync(
      resolve(process.cwd(), 'hooks/usePlayerAutoRecovery.ts'),
      'utf-8'
    )
    assert.match(hook, /window\.location\.reload\(\)/)
    assert.match(hook, /navigator\.onLine === false/)
    assert.match(hook, /if \(!claimPageReload\(now\)\) return/)
  })
})
