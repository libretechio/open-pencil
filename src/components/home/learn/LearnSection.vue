<script setup lang="ts">
import { ref } from 'vue'

import { openTour } from '@/app/demo/document'
import AppButton from '@/components/ui/button/AppButton.vue'

const tourOpening = ref(false)
const error = ref<string | null>(null)
const search = ref('responsive auto layout')

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
        Start with the guided OpenPencil document, then use focused practice briefs alongside your
        own work.
      </p>
    </div>

    <p v-if="error" class="mb-3 text-xs text-error" role="alert">{{ error }}</p>

    <div class="grid grid-cols-1 gap-3 lg:grid-cols-[1.2fr_0.8fr]">
      <article class="rounded-lg border border-border bg-panel p-4 sm:p-5">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0">
            <p class="text-2xs font-medium text-muted">Interactive lesson</p>
            <h2 class="mt-1 text-sm font-semibold">OpenPencil canvas tour</h2>
            <p class="mt-1.5 max-w-xl text-xs leading-relaxed text-muted">
              Learn selection, layers, variables, components, code export, and the editor canvas in
              a document built for hands-on practice.
            </p>
          </div>
          <AppButton
            variant="outline"
            class="min-h-11 shrink-0 justify-center sm:min-h-8"
            :loading="tourOpening"
            @click="takeTour"
          >
            Open guided tour
          </AppButton>
        </div>

        <div class="mt-5 grid gap-2 sm:grid-cols-3">
          <details class="rounded-md border border-border p-3">
            <summary class="cursor-pointer text-xs font-medium">Responsive frame</summary>
            <ol class="mt-3 list-decimal space-y-2 ps-4 text-xs leading-relaxed text-muted">
              <li>Create a phone frame and add a vertical auto-layout container.</li>
              <li>Set the card width to fill and its text group to hug content.</li>
              <li>Duplicate the frame, widen it, and inspect which constraints break.</li>
            </ol>
          </details>
          <details class="rounded-md border border-border p-3">
            <summary class="cursor-pointer text-xs font-medium">Reusable component</summary>
            <ol class="mt-3 list-decimal space-y-2 ps-4 text-xs leading-relaxed text-muted">
              <li>Turn one complete card into a component.</li>
              <li>Create compact and featured variants.</li>
              <li>Change one instance without detaching it.</li>
            </ol>
          </details>
          <details class="rounded-md border border-border p-3">
            <summary class="cursor-pointer text-xs font-medium">Design to code</summary>
            <ol class="mt-3 list-decimal space-y-2 ps-4 text-xs leading-relaxed text-muted">
              <li>Select the finished frame and open the Code panel.</li>
              <li>Compare Design JSX, HTML, React, and Vue output.</li>
              <li>Copy the smallest useful component into your coding agent.</li>
            </ol>
          </details>
        </div>
      </article>

      <form
        class="rounded-lg border border-border bg-panel p-4 sm:p-5"
        @submit.prevent="searchTutorials"
      >
        <label for="tutorial-search" class="text-sm font-semibold">Search YouTube tutorials</label>
        <p class="mt-1.5 text-xs leading-relaxed text-muted">
          Search by the thing you want to build. Results open on YouTube so the original creator
          keeps the view and attribution.
        </p>
        <input
          id="tutorial-search"
          v-model="search"
          class="mt-4 min-h-11 w-full rounded-md border border-border bg-canvas px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-panel-focus sm:min-h-8"
          autocomplete="off"
          placeholder="Dashboard, mobile checkout, component variants"
        />
        <AppButton
          type="submit"
          variant="outline"
          class="mt-3 min-h-11 w-full justify-center sm:min-h-8"
        >
          Search tutorials
        </AppButton>
      </form>
    </div>
  </section>
</template>
