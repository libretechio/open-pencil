import { computed, ref } from 'vue'

import type { EditorStore } from '@/app/editor/active-store'

import { loadTutorialSession, saveTutorialSession } from './storage'
import type { LessonSession, TutorialLesson } from './types'
import { verifyLessonStep } from './verifier'

export const tutorialSession = ref<LessonSession | null>(null)
export const currentTutorialStep = computed(() => {
  const session = tutorialSession.value
  return session?.lesson.steps[session.currentStepIndex] ?? null
})

void loadTutorialSession().then((stored) => {
  if (!tutorialSession.value) tutorialSession.value = stored
  return stored
})

function persist(): void {
  void saveTutorialSession(tutorialSession.value)
}

export function startTutorialLesson(lesson: TutorialLesson, documentId: string): void {
  tutorialSession.value = {
    lesson,
    documentId,
    currentStepIndex: 0,
    completedStepIds: [],
    hintLevel: 0,
    lastResult: null
  }
  persist()
}

export function revealTutorialHint(): void {
  const session = tutorialSession.value
  if (!session) return
  session.hintLevel = Math.min(3, session.hintLevel + 1)
  persist()
}

export function checkTutorialStep(store: EditorStore): void {
  const session = tutorialSession.value
  const step = currentTutorialStep.value
  if (!session || !step) return
  const result = verifyLessonStep(store, step)
  session.lastResult = result
  if (result.passed && !session.completedStepIds.includes(step.id)) {
    session.completedStepIds.push(step.id)
  }
  persist()
}

export function advanceTutorialStep(): void {
  const session = tutorialSession.value
  const step = currentTutorialStep.value
  if (!session || !step || !session.completedStepIds.includes(step.id)) return
  session.currentStepIndex = Math.min(session.lesson.steps.length, session.currentStepIndex + 1)
  session.hintLevel = 0
  session.lastResult = null
  persist()
}

export function closeTutorialLesson(): void {
  tutorialSession.value = null
  persist()
}
