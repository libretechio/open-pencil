<script setup lang="ts">
import { ref } from 'vue'

import { designTemplates } from '@/app/templates/catalog'
import { openDesignTemplate } from '@/app/templates/open'
import AppButton from '@/components/ui/button/AppButton.vue'

const openingId = ref<string | null>(null)
const error = ref<string | null>(null)

async function openTemplate(template: (typeof designTemplates)[number]) {
  if (openingId.value) return
  openingId.value = template.id
  error.value = null
  try {
    await openDesignTemplate(template)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    openingId.value = null
  }
}
</script>

<template>
  <section aria-labelledby="template-library-title">
    <div class="mb-3">
      <h1 id="template-library-title" class="text-base font-semibold">
        Start from a real structure
      </h1>
      <p class="mt-0.5 max-w-2xl text-pretty text-xs text-muted">
        Original, editable templates for websites, web apps, and mobile flows. Every layer opens on
        the canvas and can be exported as code.
      </p>
    </div>

    <p v-if="error" class="mb-3 text-xs text-error" role="alert">{{ error }}</p>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="template in designTemplates"
        :key="template.id"
        class="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-panel"
      >
        <div
          class="relative aspect-[16/9] overflow-hidden border-b border-border bg-panel-field p-4"
          :data-layout="template.layout"
          aria-hidden="true"
        >
          <div
            v-if="template.layout === 'editorial'"
            class="grid h-full grid-cols-[1.4fr_0.6fr] gap-3"
          >
            <div class="flex flex-col justify-end bg-canvas p-3">
              <div class="h-2 w-10 rounded-sm bg-surface/60" />
              <div class="mt-2 h-8 w-4/5 rounded-sm bg-surface" />
            </div>
            <div class="bg-primary/20" />
          </div>
          <div
            v-else-if="template.layout === 'dashboard'"
            class="grid h-full grid-cols-[3rem_1fr] gap-2"
          >
            <div class="bg-surface/10" />
            <div class="grid grid-cols-2 gap-2">
              <div class="col-span-2 bg-primary/30" />
              <div class="bg-surface/10" />
              <div class="bg-surface/10" />
            </div>
          </div>
          <div v-else class="flex h-full items-center justify-center gap-3">
            <div v-for="index in 3" :key="index" class="h-full w-1/5 rounded-md bg-surface/10" />
          </div>
        </div>

        <div class="flex flex-1 flex-col p-4">
          <p class="text-2xs font-medium text-muted">{{ template.category }}</p>
          <h2 class="mt-1 text-sm font-semibold">{{ template.name }}</h2>
          <p class="mt-1.5 flex-1 text-xs leading-relaxed text-muted">{{ template.description }}</p>
          <AppButton
            variant="outline"
            class="mt-4 min-h-11 justify-center sm:min-h-8"
            :loading="openingId === template.id"
            :disabled="openingId !== null && openingId !== template.id"
            @click="openTemplate(template)"
          >
            Open editable template
          </AppButton>
        </div>
      </article>
    </div>
  </section>
</template>
