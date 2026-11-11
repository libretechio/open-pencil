import type { LessonStep, TranscriptSegment, TutorialLesson, TutorialTranscript } from './types'

const AUTO_LAYOUT_PATTERN = /auto[ -]?layout|shift\s*\+\s*a/i
const VERTICAL_PATTERN = /vertical|column|stack(?:ed)?\s+(?:down|vertically)/i
const HORIZONTAL_PATTERN = /horizontal|row|side[ -]by[ -]side/i
const GAP_PATTERN = /(?:gap|spacing|space between)/i
const PADDING_PATTERN = /padding/i

function nearbyNumber(text: string, pattern: RegExp): number | undefined {
  const forward = text.match(new RegExp(`${pattern.source}[^0-9]{0,20}(\\d+(?:\\.\\d+)?)`, 'i'))
  const backward = text.match(
    new RegExp(
      `(\\d+(?:\\.\\d+)?)[^a-z0-9]{0,8}(?:px|pixels?)?[^a-z0-9]{0,8}${pattern.source}`,
      'i'
    )
  )
  const raw = forward?.[1] ?? backward?.[1]
  if (raw === undefined) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

function clipExcerpt(text: string): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  return words.slice(0, 18).join(' ')
}

function instructionFor(verification: LessonStep['verification']): string {
  const actions = ['Select the frame and enable auto layout']
  if (verification.direction === 'VERTICAL') actions.push('set its direction to vertical')
  if (verification.direction === 'HORIZONTAL') actions.push('set its direction to horizontal')
  if (verification.gap !== undefined) actions.push(`set the item gap to ${verification.gap}px`)
  if (verification.padding !== undefined)
    actions.push(`set every padding edge to ${verification.padding}px`)
  if (verification.horizontalPadding !== undefined)
    actions.push(`set horizontal padding to ${verification.horizontalPadding}px`)
  if (verification.verticalPadding !== undefined)
    actions.push(`set vertical padding to ${verification.verticalPadding}px`)
  return `${actions.join(', ')}.`
}

function compileStep(segment: TranscriptSegment, index: number): LessonStep | null {
  const text = segment.text.replace(/\s+/g, ' ').trim()
  if (!AUTO_LAYOUT_PATTERN.test(text) && !GAP_PATTERN.test(text) && !PADDING_PATTERN.test(text)) {
    return null
  }
  let direction: 'VERTICAL' | 'HORIZONTAL' | undefined
  if (VERTICAL_PATTERN.test(text)) direction = 'VERTICAL'
  else if (HORIZONTAL_PATTERN.test(text)) direction = 'HORIZONTAL'
  const gap = GAP_PATTERN.test(text) ? nearbyNumber(text, GAP_PATTERN) : undefined
  const horizontalPadding = nearbyNumber(text, /horizontal padding/i)
  const verticalPadding = nearbyNumber(text, /vertical padding/i)
  const hasEqualPadding =
    PADDING_PATTERN.test(text) && horizontalPadding === undefined && verticalPadding === undefined
  const padding = hasEqualPadding ? nearbyNumber(text, PADDING_PATTERN) : undefined
  const verification: LessonStep['verification'] = { kind: 'selected-auto-layout' }
  if (direction) verification.direction = direction
  if (gap !== undefined) verification.gap = gap
  if (padding !== undefined) verification.padding = padding
  if (horizontalPadding !== undefined) verification.horizontalPadding = horizontalPadding
  if (verticalPadding !== undefined) verification.verticalPadding = verticalPadding
  const diagnosticHint =
    direction === 'HORIZONTAL'
      ? 'Enable auto layout, choose the horizontal direction, then check the requested spacing values.'
      : 'Enable auto layout, choose the vertical direction, then check the requested spacing values.'
  return {
    id: `step-${index + 1}`,
    startMs: segment.startMs,
    endMs: segment.startMs + Math.max(segment.durationMs, 4000),
    instruction: instructionFor(verification),
    sourceExcerpt: clipExcerpt(text),
    hints: [
      'Keep the target frame selected so the tutor can inspect it.',
      'Use the Layout section in the right properties panel.',
      diagnosticHint
    ],
    verification
  }
}

function transcriptWindows(segments: TranscriptSegment[]): TranscriptSegment[] {
  const windows: TranscriptSegment[] = []
  let current: TranscriptSegment | null = null
  for (const segment of segments) {
    if (!current || segment.startMs - current.startMs >= 10_000) {
      if (current) windows.push(current)
      current = { ...segment }
      continue
    }
    current.text = `${current.text} ${segment.text}`
    current.durationMs = segment.startMs + segment.durationMs - current.startMs
  }
  if (current) windows.push(current)
  return windows
}

export function compileTutorialLesson(transcript: TutorialTranscript): TutorialLesson {
  const instructions = new Set<string>()
  const steps = transcriptWindows(transcript.segments)
    .map(compileStep)
    .filter((step): step is LessonStep => {
      if (!step || instructions.has(step.instruction)) return false
      instructions.add(step.instruction)
      return true
    })
    .slice(0, 12)
    .map((step, index) => ({ ...step, id: `step-${index + 1}` }))
  if (steps.length === 0) {
    throw new Error(
      'This transcript has no auto-layout steps the current verifier can check. Try an auto-layout tutorial while verifier coverage is still expanding.'
    )
  }
  return {
    schemaVersion: 'ocs-lesson-v1',
    id: `youtube-${transcript.videoId}`,
    title: transcript.title,
    creator: transcript.creator,
    sourceUrl: transcript.sourceUrl,
    videoId: transcript.videoId,
    publishedAt: transcript.publishedAt,
    transcriptLanguage: transcript.language,
    compiledAt: new Date().toISOString(),
    steps
  }
}
