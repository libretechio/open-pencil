import * as v from 'valibot'

import { readCacheJSON, removeCacheEntry, writeCacheJSON } from '@/app/cache'

import type { LessonSession } from './types'

const CACHE_KEY = 'learn/tutorial-session'
const verificationSchema = v.object({
  kind: v.literal('selected-auto-layout'),
  direction: v.optional(v.picklist(['VERTICAL', 'HORIZONTAL'])),
  gap: v.optional(v.number()),
  padding: v.optional(v.number()),
  horizontalPadding: v.optional(v.number()),
  verticalPadding: v.optional(v.number())
})
const stepSchema = v.object({
  id: v.string(),
  startMs: v.number(),
  endMs: v.number(),
  instruction: v.string(),
  sourceExcerpt: v.string(),
  hints: v.tuple([v.string(), v.string(), v.string()]),
  verification: verificationSchema
})
const lessonSchema = v.object({
  schemaVersion: v.literal('ocs-lesson-v1'),
  id: v.string(),
  title: v.string(),
  creator: v.string(),
  sourceUrl: v.string(),
  videoId: v.string(),
  publishedAt: v.nullable(v.string()),
  transcriptLanguage: v.string(),
  compiledAt: v.string(),
  steps: v.array(stepSchema)
})
const resultSchema = v.object({
  passed: v.boolean(),
  summary: v.string(),
  details: v.array(v.string())
})
const lessonSessionSchema = v.object({
  lesson: lessonSchema,
  documentId: v.string(),
  currentStepIndex: v.number(),
  completedStepIds: v.array(v.string()),
  hintLevel: v.number(),
  lastResult: v.nullable(resultSchema)
})

export async function loadTutorialSession(): Promise<LessonSession | null> {
  return readCacheJSON(CACHE_KEY, lessonSessionSchema)
}

export async function saveTutorialSession(session: LessonSession | null): Promise<void> {
  if (session) await writeCacheJSON(CACHE_KEY, session)
  else await removeCacheEntry(CACHE_KEY)
}
