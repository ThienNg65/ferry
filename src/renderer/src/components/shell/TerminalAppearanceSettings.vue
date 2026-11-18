<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { SCROLLBACK_OPTIONS, useUiStore } from '../../stores/ui.store'
import { useTerminalStreamsStore } from '../../stores/terminalStreams.store'
import {
  CUSTOM_FONT_ID,
  FONT_PRESETS,
  MAX_FONT_SIZE,
  MAX_LINE_HEIGHT,
  MIN_FONT_SIZE,
  MIN_LINE_HEIGHT,
  SCHEME_OPTIONS,
  fontFamilyName,
  resolveTheme
} from '../../utils/terminalAppearance'
import { isFontInstalled } from '../../utils/fontInstalled'
import SettingsRow from './SettingsRow.vue'

const ui = useUiStore()
const terminalStreams = useTerminalStreamsStore()

const fontItems = [
  ...FONT_PRESETS.map((preset) => ({ label: preset.label, value: preset.id })),
  { label: 'Custom…', value: CUSTOM_FONT_ID }
]

const schemeCards = computed(() =>
  SCHEME_OPTIONS.map((option) => {
    const theme = resolveTheme(option.id, ui.theme)
    return {
      ...option,
      theme,
      chips: [theme.red, theme.green, theme.yellow, theme.blue, theme.magenta, theme.cyan, theme.foreground]
    }
  })
)

const appearance = computed(() => ui.terminalAppearance)

const fontHint = computed(() => {
  const name = fontFamilyName(ui.terminalFont, ui.terminalFontCustom)
  if (!name || isFontInstalled(name)) {
    return null
  }
  return `"${name}" is not installed, so the terminal falls back to the default monospace font.`
})

const sizeDraft = ref<number | null>(ui.terminalFontSize)
const lineHeightDraft = ref<number | null>(ui.terminalLineHeight)

watch(() => ui.terminalFontSize, (value) => { sizeDraft.value = value })
watch(() => ui.terminalLineHeight, (value) => { lineHeightDraft.value = value })

function onSize(value: number | null | undefined): void {
  sizeDraft.value = value ?? null
  if (typeof value === 'number') {
    ui.setTerminalFontSize(value)
  }
}

function onLineHeight(value: number | null | undefined): void {
  lineHeightDraft.value = value ?? null
  if (typeof value === 'number') {
    ui.setTerminalLineHeight(value)
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <h2 class="text-base font-semibold text-highlighted">Terminal</h2>
      <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-rotate-ccw" @click="ui.resetTerminalAppearance()">
        Reset
      </UButton>
    </div>

    <div class="flex flex-col gap-1">
      <span class="text-xs text-muted">Preview</span>
      <pre
        aria-hidden="true"
        class="m-0 overflow-hidden rounded-md border border-muted p-2"
        :style="{
          background: appearance.theme.background,
          color: appearance.theme.foreground,
          fontFamily: appearance.fontFamily,
          fontSize: `${appearance.fontSize}px`,
          lineHeight: appearance.lineHeight
        }"
      ><span :style="{ color: appearance.theme.green }">user@host</span>:<span :style="{ color: appearance.theme.blue }">~</span>$ ls --color
<span :style="{ color: appearance.theme.blue }">projects</span>  <span :style="{ color: appearance.theme.green }">deploy.sh</span>  <span :style="{ color: appearance.theme.yellow }">notes.txt</span>
<span :style="{ color: appearance.theme.red }">error:</span> permission denied</pre>
    </div>

    <div role="radiogroup" aria-label="Terminal color scheme" class="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <label
        v-for="card in schemeCards"
        :key="card.id"
        class="relative flex cursor-pointer flex-col gap-1.5 rounded-md border p-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary"
        :class="ui.terminalScheme === card.id ? 'border-primary ring-1 ring-primary' : 'border-muted hover:border-accented'"
      >
        <input
          type="radio"
          name="terminal-scheme"
          class="sr-only"
          :value="card.id"
          :checked="ui.terminalScheme === card.id"
          @change="ui.setTerminalScheme(card.id)"
        />
        <span class="flex items-center justify-between gap-2 text-xs font-medium text-highlighted">
          {{ card.name }}
          <UIcon v-if="ui.terminalScheme === card.id" name="i-lucide-check" class="size-3.5 shrink-0 text-primary" />
        </span>
        <span class="flex h-4 overflow-hidden rounded-sm" :style="{ background: card.theme.background }">
          <span v-for="(chip, i) in card.chips" :key="i" class="m-0.5 flex-1 rounded-sm" :style="{ background: chip }" />
        </span>
      </label>
    </div>

    <div>
      <SettingsRow label="Font" for-id="terminal-font" stacked>
        <div class="flex flex-col gap-1.5">
          <USelect
            id="terminal-font"
            :model-value="ui.terminalFont"
            :items="fontItems"
            class="w-full"
            @update:model-value="(v: string) => ui.setTerminalFont(v)"
          />
          <UInput
            v-if="ui.terminalFont === CUSTOM_FONT_ID"
            :model-value="ui.terminalFontCustom"
            aria-label="Custom font name"
            placeholder="Installed font name, e.g. Hack"
            class="w-full"
            @update:model-value="(v: string) => ui.setTerminalFontCustom(v)"
          />
          <p v-if="fontHint" class="flex items-start gap-1.5 text-xs text-warning" role="status">
            <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-3.5 shrink-0" />
            {{ fontHint }}
          </p>
        </div>
      </SettingsRow>
      <SettingsRow label="Size (px)" for-id="terminal-font-size">
        <UInputNumber
          id="terminal-font-size"
          :model-value="sizeDraft"
          :min="MIN_FONT_SIZE"
          :max="MAX_FONT_SIZE"
          :step="1"
          class="w-32"
          @update:model-value="onSize"
          @blur="sizeDraft = ui.terminalFontSize"
        />
      </SettingsRow>
      <SettingsRow label="Line height" for-id="terminal-line-height">
        <UInputNumber
          id="terminal-line-height"
          :model-value="lineHeightDraft"
          :min="MIN_LINE_HEIGHT"
          :max="MAX_LINE_HEIGHT"
          :step="0.05"
          :format-options="{ minimumFractionDigits: 2, maximumFractionDigits: 2 }"
          class="w-32"
          @update:model-value="onLineHeight"
          @blur="lineHeightDraft = ui.terminalLineHeight"
        />
      </SettingsRow>
      <SettingsRow label="Scrollback (lines)" for-id="terminal-scrollback">
        <USelect
          id="terminal-scrollback"
          :model-value="ui.terminalScrollback"
          :items="SCROLLBACK_OPTIONS"
          class="w-32"
          @update:model-value="(v: number) => { ui.setTerminalScrollback(v); terminalStreams.applyAppearance() }"
        />
      </SettingsRow>
      <SettingsRow
        label="Predictive local echo"
        description="Show typed characters immediately on slow SSH servers; pauses automatically in password prompts and full-screen apps."
        for-id="terminal-predictive-echo"
      >
        <USwitch
          id="terminal-predictive-echo"
          :model-value="ui.terminalPredictiveEcho"
          @update:model-value="(v: boolean) => ui.setTerminalPredictiveEcho(v)"
        />
      </SettingsRow>
    </div>
  </div>
</template>
