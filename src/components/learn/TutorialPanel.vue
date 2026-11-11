<script setup lang="ts">
import { computed } from 'vue'

import {
  advanceTutorialStep,
  checkTutorialStep,
  closeTutorialLesson,
  currentTutorialStep,
  revealTutorialHint,
  tutorialSession
} from '@/app/learn/session'
import type { Tab } from '@/app/tabs'
import AppButton from '@/components/ui/button/AppButton.vue'
import IconButton from '@/components/ui/button/IconButton.vue'

const { tab } = defineProps<{ tab: Tab }>()
const session = computed(() =>
  tutorialSession.value?.documentId === tab.id ? tutorialSession.value : null
)
const complete = computed(
  () => !!session.value && session.value.currentStepIndex >= session.value.lesson.steps.length
)
const playerURL = computed(() => {
  const active = session.value
  const step = currentTutorialStep.value
  if (!active || !step) return ''
  const start = Math.floor(step.startMs / 1000)
  return `https://www.youtube-nocookie.com/embed/${active.lesson.videoId}?start=${start}&rel=0`
})
const canAdvance = computed(() => {
  const active = session.value
  const step = currentTutorialStep.value
  return !!active && !!step && active.completedStepIds.includes(step.id)
})
</script>

<template>
  <aside
    v-if="session"
    aria-labelledby="tutorial-panel-title"
    class="fixed inset-x-2 bottom-2 z-50 flex max-h-[min(42rem,calc(100dvh-1rem))] flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-lg sm:inset-x-auto sm:inset-e-3 sm:bottom-3 sm:w-[23rem]"
  >
    <header class="flex shrink-0 items-start gap-3 border-b border-border p-3">
      <div class="min-w-0 flex-1">
        <p class="text-2xs font-medium text-muted">
          Step {{ Math.min(session.currentStepIndex + 1, session.lesson.steps.length) }} of
          {{ session.lesson.steps.length }}
        </p>
        <h2 id="tutorial-panel-title" class="mt-0.5 truncate text-sm font-semibold">
          {{ session.lesson.title }}
        </h2>
      </div>
      <IconButton label="Close tutorial" size="sm" @click="closeTutorialLesson">
        <icon-lucide-x class="size-3.5" />
      </IconButton>
    </header>

    <div v-if="complete" class="overflow-y-auto p-4">
      <h3 class="text-sm font-semibold">Lesson complete</h3>
      <p class="mt-2 text-xs leading-relaxed text-muted">
        Every supported checkpoint in this tutorial passed against your document state.
      </p>
      <AppButton variant="outline" class="mt-4 w-full justify-center" @click="closeTutorialLesson">
        Close lesson
      </AppButton>
    </div>

    <div v-else-if="currentTutorialStep" class="overflow-y-auto">
      <div class="aspect-video border-b border-border bg-canvas">
        <iframe
          class="size-full"
          :src="playerURL"
          :aria-label="`Tutorial video: ${session.lesson.title}`"
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
        />
      </div>
      <div class="p-4">
        <p class="text-xs leading-relaxed">{{ currentTutorialStep.instruction }}</p>
        <p class="mt-2 text-2xs text-muted">
          Video segment starts at {{ Math.floor(currentTutorialStep.startMs / 1000) }}s. The tutor
          only reads the selected layer; it never edits your file.
        </p>

        <div
          v-if="session.lastResult"
          class="mt-3 rounded-md border p-3 text-xs"
          :class="session.lastResult.passed ? 'border-success/40' : 'border-warning/40'"
          :role="session.lastResult.passed ? 'status' : 'alert'"
        >
          <p class="font-medium">{{ session.lastResult.summary }}</p>
          <ul class="mt-1.5 list-disc space-y-1 ps-4 text-muted">
            <li v-for="detail in session.lastResult.details" :key="detail">{{ detail }}</li>
          </ul>
        </div>

        <div v-if="session.hintLevel > 0" class="mt-3 space-y-2" aria-live="polite">
          <p class="text-2xs font-medium text-muted">Hints</p>
          <ol class="list-decimal space-y-1.5 ps-4 text-xs text-muted">
            <li v-for="hint in currentTutorialStep.hints.slice(0, session.hintLevel)" :key="hint">
              {{ hint }}
            </li>
          </ol>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-2">
          <AppButton
            variant="outline"
            class="min-h-11 justify-center sm:min-h-8"
            :disabled="session.hintLevel >= currentTutorialStep.hints.length"
            @click="revealTutorialHint"
          >
            Show a hint
          </AppButton>
          <AppButton
            v-if="!canAdvance"
            class="min-h-11 justify-center sm:min-h-8"
            @click="checkTutorialStep(tab.store)"
          >
            Check my work
          </AppButton>
          <AppButton v-else class="min-h-11 justify-center sm:min-h-8" @click="advanceTutorialStep">
            Next step
          </AppButton>
        </div>
      </div>
    </div>
  </aside>
</template>
