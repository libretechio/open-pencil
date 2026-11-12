<script setup lang="ts">
import { ref } from 'vue'

import { openTour } from '@/app/demo/document'
import { compileTutorialLesson } from '@/app/learn/compiler'
import { startTutorialLesson } from '@/app/learn/session'
import { transcriptFromCaptions } from '@/app/learn/transcript'
import type { TutorialTranscript } from '@/app/learn/types'
import { createDocumentTab } from '@/app/tabs'
import AppButton from '@/components/ui/button/AppButton.vue'

const tourOpening = ref(false)
const compiling = ref(false)
const error = ref<string | null>(null)
const tutorialURL = ref('')
const search = ref('responsive auto layout')
const pasteOpen = ref(false)
const pastedCaptions = ref('')

function isTutorialTranscript(value: unknown): value is TutorialTranscript {
  return (
    typeof value === 'object' &&
    value !== null &&
    'videoId' in value &&
    'segments' in value &&
    Array.isArray(value.segments)
  )
}

function messageFrom(body: unknown, fallback: string): string {
  return typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'string'
    ? body.error
    : fallback
}

function codeFrom(body: unknown): string | null {
  return typeof body === 'object' &&
    body !== null &&
    'code' in body &&
    typeof body.code === 'string'
    ? body.code
    : null
}

async function takeTour() {
  if (tourOpening.value) return
  tourOpening.value = true
  error.value = null
  try {
    await openTour()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    tourOpening.value = false
  }
}

function startLesson(transcript: TutorialTranscript) {
  const lesson = compileTutorialLesson(transcript)
  const tab = createDocumentTab('design')
  tab.store.state.documentName = `Lesson: ${lesson.title}`
  startTutorialLesson(lesson, tab.id)
}

async function learnTutorial() {
  const url = tutorialURL.value.trim()
  if (!url || compiling.value) return
  compiling.value = true
  error.value = null
  try {
    const response = await fetch('/api/tutorials/transcript', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url })
    })
    const body: unknown = await response.json()
    if (!response.ok || !isTutorialTranscript(body)) {
      const code = codeFrom(body)
      if (code === 'youtube-blocked' || code === 'no-captions') pasteOpen.value = true
      throw new Error(messageFrom(body, 'The transcript could not be loaded.'))
    }
    startLesson(body)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    compiling.value = false
  }
}

function buildFromCaptions() {
  if (compiling.value) return
  error.value = null
  compiling.value = true
  try {
    startLesson(
      transcriptFromCaptions({
        captions: pastedCaptions.value,
        url: tutorialURL.value,
        title: tutorialURL.value.trim() ? undefined : 'Pasted tutorial transcript'
      })
    )
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    compiling.value = false
  }
}

function searchTutorials() {
  const query = search.value.trim()
  if (!query) return
  window.open(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(`Figma ${query} tutorial`)}`,
    '_blank',
    'noopener,noreferrer'
  )
}
</script>

<template>
  <section aria-labelledby="learn-design-title">
    <div class="mb-3">
      <h1 id="learn-design-title" class="text-base font-semibold">Learn by changing the file</h1>
      <p class="mt-0.5 max-w-2xl text-pretty text-xs text-muted">
        Choose a YouTube tutorial. The tutor turns supported auto-layout instructions into document
        checkpoints and waits for you to complete them.
      </p>
    </div>

    <p v-if="error" class="mb-3 text-xs text-error" role="alert">{{ error }}</p>

    <div class="grid grid-cols-1 gap-3 lg:grid-cols-[1.2fr_0.8fr]">
      <article class="rounded-lg border border-border bg-panel p-4 sm:p-5">
        <p class="text-2xs font-medium text-muted">YouTube tutorial</p>
        <h2 class="mt-1 text-sm font-semibold">Learn this tutorial inside the editor</h2>
        <p class="mt-1.5 max-w-xl text-xs leading-relaxed text-muted">
          Paste a YouTube link. Libretech Design reads its available captions, keeps the video
          attributed to its creator, and builds the checkpoints it can verify without editing your
          work.
        </p>
        <form class="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]" @submit.prevent="learnTutorial">
          <label for="tutorial-url" class="sr-only">YouTube tutorial URL</label>
          <input
            id="tutorial-url"
            v-model="tutorialURL"
            type="url"
            required
            inputmode="url"
            autocomplete="url"
            class="min-h-11 min-w-0 rounded-md border border-border bg-canvas px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-panel-focus sm:min-h-8"
            placeholder="https://www.youtube.com/watch?v=…"
          />
          <AppButton type="submit" class="min-h-11 justify-center sm:min-h-8" :loading="compiling">
            Build interactive lesson
          </AppButton>
        </form>

        <p v-if="compiling" class="mt-2 text-2xs text-muted" role="status">
          Reading the captions. This can take up to 30 seconds.
        </p>
        <div class="mt-3 rounded-md border border-border bg-canvas p-3">
          <button
            type="button"
            class="flex min-h-9 w-full items-center justify-between gap-2 text-start text-xs font-medium"
            :aria-expanded="pasteOpen"
            aria-controls="paste-transcript-panel"
            @click="pasteOpen = !pasteOpen"
          >
            <span>Paste a transcript instead</span>
            <icon-lucide-chevron-down
              class="size-3.5 shrink-0 text-muted transition-transform"
              :class="pasteOpen ? 'rotate-180' : ''"
            />
          </button>
          <div v-if="pasteOpen" id="paste-transcript-panel" class="mt-3">
            <p class="text-2xs leading-relaxed text-muted">
              Use this when YouTube will not hand over the captions. Open the video, choose
              <span class="font-medium text-primary">Show transcript</span>, copy the panel, and
              paste it here. Captions copied as VTT or SRT work too.
            </p>
            <label for="pasted-captions" class="mt-3 block text-2xs font-medium text-muted">
              Tutorial transcript
            </label>
            <textarea
              id="pasted-captions"
              v-model="pastedCaptions"
              rows="5"
              class="mt-1.5 w-full resize-y rounded-md border border-border bg-canvas px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-panel-focus"
              placeholder="0:12&#10;select both cards and press shift a to add auto layout&#10;0:20&#10;set the gap to 16"
            />
            <AppButton
              variant="outline"
              class="mt-2 min-h-11 w-full justify-center sm:min-h-8"
              :disabled="!pastedCaptions.trim()"
              @click="buildFromCaptions"
            >
              Build lesson from pasted transcript
            </AppButton>
          </div>
        </div>

        <p class="mt-2 text-2xs text-muted">
          First verifier: selected-frame auto layout, direction, gap, and equal padding. More design
          actions will be added without weakening the read-only tutor boundary.
        </p>
      </article>

      <article class="rounded-lg border border-border bg-panel p-4 sm:p-5">
        <p class="text-2xs font-medium text-muted">Built-in orientation</p>
        <h2 class="mt-1 text-sm font-semibold">OpenPencil canvas tour</h2>
        <p class="mt-1.5 text-xs leading-relaxed text-muted">
          Learn selection, layers, variables, components, code export, and the editor canvas in a
          prepared practice file.
        </p>
        <AppButton
          variant="outline"
          class="mt-4 min-h-11 w-full justify-center sm:min-h-8"
          :loading="tourOpening"
          @click="takeTour"
        >
          Open guided tour
        </AppButton>
      </article>
    </div>

    <form
      class="mt-3 flex flex-col gap-2 rounded-lg border border-border bg-panel p-4 sm:flex-row sm:items-end sm:p-5"
      @submit.prevent="searchTutorials"
    >
      <div class="min-w-0 flex-1">
        <label for="tutorial-search" class="text-xs font-medium">Find a tutorial on YouTube</label>
        <input
          id="tutorial-search"
          v-model="search"
          class="mt-2 min-h-11 w-full rounded-md border border-border bg-canvas px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-panel-focus sm:min-h-8"
          autocomplete="off"
          placeholder="Responsive dashboard, mobile checkout, component variants"
        />
      </div>
      <AppButton
        type="submit"
        variant="outline"
        class="min-h-11 shrink-0 justify-center sm:min-h-8"
      >
        Search YouTube
      </AppButton>
    </form>
  </section>
</template>
