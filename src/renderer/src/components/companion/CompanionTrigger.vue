<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCompanionStore } from '../../stores/companion.store'
import { useUiStore } from '../../stores/ui.store'
import CompanionAvatar from './CompanionAvatar.vue'

const props = withDefaults(
  defineProps<{
    placement: 'header' | 'dock-bottom' | 'dock-right-header' | 'dock-right-rail'
    showNotice?: boolean
  }>(),
  {
    showNotice: false
  }
)

const companion = useCompanionStore()
const ui = useUiStore()

const triggerRef = ref<HTMLButtonElement | null>(null)
const bubbleStyle = ref<Record<string, string>>({})

const tooltipText = computed(() =>
  companion.open
    ? 'Close Ferry Companion (Ctrl+Space)'
    : [
        companion.effectiveAvatarState !== 'idle' ? companion.avatarLabel : null,
        companion.prodSiteLabel,
        companion.hasNotice ? companion.notice?.title : null,
        'Ferry Companion (Ctrl+Space)'
      ]
        .filter(Boolean)
        .join(' · ')
)
const tooltipSide = computed(() => (props.placement === 'dock-right-rail' ? 'left' : 'bottom'))

const showBubble = computed(
  () => props.showNotice && companion.notice !== null && !companion.quietMode && !companion.open
)

function updateBubblePosition(): void {
  const el = triggerRef.value
  if (!el || typeof window === 'undefined') return
  const rect = el.getBoundingClientRect()
  const bubbleWidth = Math.min(288, window.innerWidth - 16)
  const gap = 8

  if (props.placement === 'header' || props.placement === 'dock-right-header') {
    const left = Math.max(8, Math.min(rect.right - bubbleWidth, window.innerWidth - bubbleWidth - 8))
    const top = Math.max(8, rect.bottom + gap)
    bubbleStyle.value = {
      top: `${Math.round(top)}px`,
      left: `${Math.round(left)}px`,
      width: `${bubbleWidth}px`
    }
    return
  }

  if (props.placement === 'dock-right-rail') {
    const left = Math.max(8, rect.left - bubbleWidth - gap)
    const bottom = Math.max(8, window.innerHeight - rect.bottom)
    bubbleStyle.value = {
      bottom: `${Math.round(bottom)}px`,
      left: `${Math.round(left)}px`,
      width: `${bubbleWidth}px`
    }
    return
  }

  // dock-bottom (with safety fallback if trigger sits near top edge)
  const left = Math.max(8, Math.min(rect.right - bubbleWidth, window.innerWidth - bubbleWidth - 8))
  if (rect.top < 160) {
    bubbleStyle.value = {
      top: `${Math.round(Math.max(8, rect.bottom + gap))}px`,
      left: `${Math.round(left)}px`,
      width: `${bubbleWidth}px`
    }
    return
  }
  const bottom = Math.max(8, window.innerHeight - rect.top + gap)
  bubbleStyle.value = {
    bottom: `${Math.round(bottom)}px`,
    left: `${Math.round(left)}px`,
    width: `${bubbleWidth}px`
  }
}

watch(
  [showBubble, () => ui.dockPosition, () => ui.dockHeight, () => ui.dockWidth, () => props.placement],
  ([visible]) => {
    if (visible) {
      void nextTick(updateBubblePosition)
    }
  },
  { immediate: true }
)

function onGlobalKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && !e.defaultPrevented && showBubble.value) {
    if (e.target instanceof HTMLElement && e.target.closest('.xterm')) return
    if (document.querySelector('[role="dialog"]:not([data-state="closed"])')) return
    e.preventDefault()
    e.stopPropagation()
    companion.dismissNotice()
  }
}

function onWindowResize(): void {
  if (showBubble.value) updateBubblePosition()
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('resize', onWindowResize)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('resize', onWindowResize)
})
</script>

<template>
  <div class="relative inline-flex items-center">
    <UTooltip :text="tooltipText" :content="{ side: tooltipSide }">
      <button
        ref="triggerRef"
        type="button"
        :aria-label="tooltipText"
        :aria-expanded="companion.open"
        class="inline-flex size-6 cursor-pointer items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-primary"
        :class="[
          companion.open
            ? 'bg-[color-mix(in_oklab,var(--ferry-companion-accent,var(--ui-color-primary-500))_15%,transparent)] text-[var(--ferry-companion-accent,var(--ui-color-primary-500))]'
            : 'text-muted hover:bg-elevated/70 hover:text-highlighted',
          showBubble || companion.open ? '' : 'ferry-pressable'
        ]"
        data-companion-trigger
        :data-companion-placement="placement"
        @click="companion.togglePanel()"
      >
        <CompanionAvatar
          :state="companion.effectiveAvatarState"
          :size="16"
          :prod="companion.isProd"
          :noticing="companion.hasNotice"
        />
      </button>
    </UTooltip>

    <!-- Teleported to body so BottomDock overflow-hidden never clips it and glass blur never nests. -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="showBubble && companion.notice"
          role="status"
          aria-live="polite"
          :style="bubbleStyle"
          class="fixed z-50 rounded-lg border border-default p-3 text-left shadow-lg"
          :class="ui.glassUiEnabled ? 'ferry-glass-overlay' : 'bg-default'"
          data-companion-notice
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-center gap-1.5 min-w-0">
              <CompanionAvatar :size="16" noticing />
              <p class="truncate text-xs font-semibold text-highlighted">
                {{ companion.notice.title }}
              </p>
            </div>
            <button
              type="button"
              aria-label="Dismiss companion notice"
              class="rounded p-0.5 text-muted transition-colors hover:bg-elevated hover:text-default focus-visible:outline-2 focus-visible:outline-primary cursor-pointer"
              @click="companion.dismissNotice()"
            >
              <UIcon name="i-lucide-x" class="size-3.5" />
            </button>
          </div>
          <p class="mt-1.5 text-xs leading-relaxed text-muted">
            {{ companion.notice.body }}
          </p>
          <div class="mt-2.5 flex items-center justify-end gap-1.5">
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              @click="companion.dismissNotice()"
            >
              Dismiss
            </UButton>
            <UButton
              size="xs"
              color="primary"
              variant="solid"
              @click="companion.openNoticeAction()"
            >
              {{ companion.notice.ctaLabel }}
            </UButton>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
