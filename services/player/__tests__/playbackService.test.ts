import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { playbackService } from '../playbackService'

describe('PlaybackService', () => {
  beforeEach(async () => {
    // Ensure any pending operations from previous tests are done
    await playbackService.waitForCompletion()
  })

  test('isOperationInProgress returns false initially', () => {
    assert.equal(playbackService.isOperationInProgress(), false)
  })

  test('isOperationInProgress returns true while operation is running', async () => {
    let resolveOperation: () => void = () => {}
    const operationPromise = new Promise<void>((resolve) => {
      resolveOperation = resolve
    })

    const executionPromise = playbackService.executePlayback(async () => {
      await operationPromise
    }, 'test-op')

    // Give it a tick to start processing the queue
    await new Promise((r) => setTimeout(r, 0))

    assert.equal(playbackService.isOperationInProgress(), true)

    resolveOperation()
    await executionPromise

    assert.equal(playbackService.isOperationInProgress(), false)
  })

  test('isOperationInProgress returns false after operation fails', async () => {
    const error = new Error('Test failure')

    try {
      await playbackService.executePlayback(async () => {
        throw error
      }, 'fail-op')
    } catch (e) {
      assert.strictEqual(e, error)
    }

    assert.equal(playbackService.isOperationInProgress(), false)
  })

  test('serialized operations track pending count correctly', async () => {
    const ops: number[] = []

    const p1 = playbackService.executePlayback(async () => {
      await new Promise((r) => setTimeout(r, 10))
      ops.push(1)
    }, 'op1')

    const p2 = playbackService.executePlayback(async () => {
      await new Promise((r) => setTimeout(r, 10))
      ops.push(2)
    }, 'op2')

    // Both queued
    assert.equal(playbackService.isOperationInProgress(), true)

    await Promise.all([p1, p2])

    assert.deepEqual(ops, [1, 2]) // Serialized order
    assert.equal(playbackService.isOperationInProgress(), false)
  })
})
