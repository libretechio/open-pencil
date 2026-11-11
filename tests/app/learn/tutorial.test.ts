import { describe, expect, test } from 'bun:test'

import type { EditorStore } from '@/app/editor/active-store'
import { compileTutorialLesson } from '@/app/learn/compiler'
import type { LessonStep, TutorialTranscript } from '@/app/learn/types'
import { verifyLessonStep } from '@/app/learn/verifier'

const transcript: TutorialTranscript = {
  videoId: '1odqpkfkDL8',
  sourceUrl: 'https://www.youtube.com/watch?v=1odqpkfkDL8',
  title: 'Auto layout lesson',
  creator: 'Example creator',
  publishedAt: '2024-12-05',
  language: 'en',
  segments: [
    { startMs: 0, durationMs: 2000, text: 'Select the cards and add auto layout.' },
    { startMs: 2100, durationMs: 2000, text: 'Set it to a vertical stack.' },
    { startMs: 4100, durationMs: 2000, text: 'Use horizontal padding 24' },
    { startMs: 6100, durationMs: 2000, text: 'and vertical padding 16.' }
  ]
}

describe('YouTube tutorial compiler', () => {
  test('compiles transcript instructions into a sourced, verifiable step', () => {
    const lesson = compileTutorialLesson(transcript)
    expect(lesson.videoId).toBe('1odqpkfkDL8')
    expect(lesson.steps).toHaveLength(1)
    expect(lesson.steps[0]?.verification).toEqual({
      kind: 'selected-auto-layout',
      direction: 'VERTICAL',
      horizontalPadding: 24,
      verticalPadding: 16
    })
  })

  test('rejects transcripts without a supported document-state check', () => {
    expect(() =>
      compileTutorialLesson({
        ...transcript,
        segments: [{ startMs: 0, durationMs: 2000, text: 'Choose a color you like.' }]
      })
    ).toThrow('no auto-layout steps')
  })
})

describe('Tutorial checkpoint verifier', () => {
  test('passes only when the selected frame matches the expected layout state', () => {
    const step: LessonStep = {
      id: 'step-1',
      startMs: 0,
      endMs: 5000,
      instruction: 'Set auto layout.',
      sourceExcerpt: '',
      hints: ['One', 'Two', 'Three'],
      verification: {
        kind: 'selected-auto-layout',
        direction: 'VERTICAL',
        gap: 16,
        horizontalPadding: 24,
        verticalPadding: 16
      }
    }
    const node = {
      id: 'frame-1',
      type: 'FRAME',
      layoutMode: 'VERTICAL',
      itemSpacing: 16,
      paddingTop: 16,
      paddingRight: 24,
      paddingBottom: 16,
      paddingLeft: 24
    }
    const store = {
      state: { selectedIds: new Set(['frame-1']) },
      graph: { getNode: () => node }
    } as EditorStore
    expect(verifyLessonStep(store, step)).toEqual({
      passed: true,
      summary: 'Checkpoint passed.',
      details: ['The selected frame matches this step.']
    })
    node.itemSpacing = 8
    expect(verifyLessonStep(store, step)).toMatchObject({
      passed: false,
      details: ['Item gap is 8px, expected 16px.']
    })
  })
})
