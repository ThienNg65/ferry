<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { window as nlWindow } from '@neutralinojs/lib'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract'
import type { WindowIsMaximizedResult, WindowStateEvent } from '@shared/contract'
import { invoke, onEvent } from '../../api'
import { isNeutralinoRuntime } from '../../bridge/neutralinoApi'
import { computeResizedBounds, type ResizeDirection } from '../../utils/windowBounds'

const isRuntime = isNeutralinoRuntime()
const isMaximized = ref(false)
let unsubscribe: (() => void) | null = null

let activeDir: ResizeDirection | null = null
let ready = false
let capturedEl: HTMLElement | null = null
let capturedPointerId: number | null = null
let startScreenX = 0
let startScreenY = 0
let startBounds = { x: 0, y: 0, width: 1280, height: 800 }
let lastAppliedX = 0
let lastAppliedY = 0
let lastAppliedWidth = 0
let lastAppliedHeight = 0
let scale = 1
let rafId: number | null = null
let resizeInFlight = false
let hasPendingResize = false
let resizeGen = 0
let latestScreenX = 0
let latestScreenY = 0

function flushResize(): void {
  if (!activeDir || !ready) return
  if (resizeInFlight) {
    hasPendingResize = true
    return
  }
  const deltaX = (latestScreenX - startScreenX) * scale
  const deltaY = (latestScreenY - startScreenY) * scale
  const next = computeResizedBounds(startBounds, deltaX, deltaY, activeDir, scale)
  const ops: Promise<unknown>[] = []
  if (next.x !== lastAppliedX || next.y !== lastAppliedY) {
    lastAppliedX = next.x
    lastAppliedY = next.y
    ops.push(nlWindow.move(next.x, next.y))
  }
  if (next.width !== lastAppliedWidth || next.height !== lastAppliedHeight) {
    lastAppliedWidth = next.width
    lastAppliedHeight = next.height
    ops.push(nlWindow.setSize({ width: next.width, height: next.height }))
  }
  if (ops.length === 0) return
  resizeInFlight = true
  const gen = resizeGen
  void Promise.all(ops).finally(() => {
    if (gen !== resizeGen) return
    resizeInFlight = false
    if (hasPendingResize) {
      hasPendingResize = false
      flushResize()
    }
  })
}

function stopResize(): void {
  if (!activeDir) return
  const wasReady = ready
  activeDir = null
  ready = false
  resizeGen++
  resizeInFlight = false
  hasPendingResize = false
  if (capturedEl && capturedPointerId !== null) {
    try {
      capturedEl.releasePointerCapture?.(capturedPointerId)
    } catch {
      // Ignore if pointer capture was already released.
    }
  }
  capturedEl = null
  capturedPointerId = null
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', stopResize)
  window.removeEventListener('pointercancel', stopResize)
  if (wasReady) {
    window.dispatchEvent(new CustomEvent('ferry:window-bounds-dirty'))
  }
}

function onPointerMove(e: PointerEvent): void {
  if (!activeDir || !ready) return
  latestScreenX = e.screenX
  latestScreenY = e.screenY
  if (rafId !== null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    flushResize()
  })
}

function startResize(dir: ResizeDirection, e: PointerEvent): void {
  if (!isRuntime || isMaximized.value || e.button !== 0) return
  e.preventDefault()
  if (activeDir) stopResize()
  activeDir = dir
  ready = false
  const gen = ++resizeGen
  startScreenX = e.screenX
  startScreenY = e.screenY
  latestScreenX = e.screenX
  latestScreenY = e.screenY

  const target = e.currentTarget as HTMLElement | null
  if (target) {
    try {
      target.setPointerCapture?.(e.pointerId)
      capturedEl = target
      capturedPointerId = e.pointerId
    } catch {
      // Ignore environments without pointer capture support.
    }
  }

  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', stopResize)
  window.addEventListener('pointercancel', stopResize)

  void Promise.all([nlWindow.getPosition(), nlWindow.getSize()])
    .then(([pos, size]) => {
      if (!activeDir || gen !== resizeGen) return
      const width = size.width ?? 1280
      const height = size.height ?? 800
      startBounds = { x: pos.x, y: pos.y, width, height }
      lastAppliedX = pos.x
      lastAppliedY = pos.y
      lastAppliedWidth = width
      lastAppliedHeight = height
      scale = typeof window.innerWidth === 'number' && window.innerWidth > 0 && size.width ? size.width / window.innerWidth : 1
      ready = true
    })
    .catch(() => {
      if (gen === resizeGen) stopResize()
    })
}

onMounted(async () => {
  if (!isRuntime) return
  unsubscribe = onEvent<WindowStateEvent>(EVENT_CHANNELS.windowStateChange, (evt) => {
    isMaximized.value = evt.isMaximized
  })
  const result = await invoke<WindowIsMaximizedResult>(INVOKE_CHANNELS.windowIsMaximized)
  isMaximized.value = result.isMaximized
})

onUnmounted(() => {
  stopResize()
  unsubscribe?.()
})
</script>

<template>
  <template v-if="isRuntime && !isMaximized">
    <div class="fixed inset-x-2 top-0 z-100 h-1 cursor-ns-resize" @pointerdown="startResize('n', $event)" />
    <div class="fixed inset-x-2 bottom-0 z-100 h-1 cursor-ns-resize" @pointerdown="startResize('s', $event)" />
    <div class="fixed inset-y-2 left-0 z-100 w-1 cursor-ew-resize" @pointerdown="startResize('w', $event)" />
    <div class="fixed inset-y-2 right-0 z-100 w-1 cursor-ew-resize" @pointerdown="startResize('e', $event)" />
    <div class="fixed top-0 left-0 z-101 size-2 cursor-nwse-resize" @pointerdown="startResize('nw', $event)" />
    <div class="fixed top-0 right-0 z-101 size-2 cursor-nesw-resize" @pointerdown="startResize('ne', $event)" />
    <div class="fixed bottom-0 left-0 z-101 size-2 cursor-nesw-resize" @pointerdown="startResize('sw', $event)" />
    <div class="fixed bottom-0 right-0 z-101 size-2 cursor-nwse-resize" @pointerdown="startResize('se', $event)" />
  </template>
</template>
