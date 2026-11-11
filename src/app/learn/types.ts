export type TranscriptSegment = {
  startMs: number
  durationMs: number
  text: string
}

export type TutorialTranscript = {
  videoId: string
  sourceUrl: string
  title: string
  creator: string
  publishedAt: string | null
  language: string
  segments: TranscriptSegment[]
}

export type AutoLayoutVerification = {
  kind: 'selected-auto-layout'
  direction?: 'VERTICAL' | 'HORIZONTAL'
  gap?: number
  padding?: number
  horizontalPadding?: number
  verticalPadding?: number
}

export type LessonStep = {
  id: string
  startMs: number
  endMs: number
  instruction: string
  sourceExcerpt: string
  hints: [string, string, string]
  verification: AutoLayoutVerification
}

export type TutorialLesson = {
  schemaVersion: 'ocs-lesson-v1'
  id: string
  title: string
  creator: string
  sourceUrl: string
  videoId: string
  publishedAt: string | null
  transcriptLanguage: string
  compiledAt: string
  steps: LessonStep[]
}

export type VerificationResult = {
  passed: boolean
  summary: string
  details: string[]
}

export type LessonSession = {
  lesson: TutorialLesson
  documentId: string
  currentStepIndex: number
  completedStepIds: string[]
  hintLevel: number
  lastResult: VerificationResult | null
}
