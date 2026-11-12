import type { TranscriptSegment, TutorialTranscript } from './types'

const DEFAULT_SEGMENT_MS = 4000
const TIMECODE_PATTERN = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/
const SKIPPED_LINE_PATTERN = /^(WEBVTT|Kind:|Language:|NOTE\b|STYLE\b|REGION\b)/i

export function parseTimecode(value: string): number | null {
  const match = TIMECODE_PATTERN.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1] || 0)
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const fraction = Number(`0.${match[4] || 0}`)
  return Math.round((hours * 3600 + minutes * 60 + seconds + fraction) * 1000)
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function cleanText(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

type Cue = { startMs: number; endMs: number | null; text: string }

/**
 * Reads the caption formats a person can realistically copy out of YouTube:
 * WebVTT and SRT cue files, the transcript panel copy ("0:12" then the line),
 * and plain prose with no timings at all.
 */
export function parseCaptions(raw: string): TranscriptSegment[] {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n')
  const cues: Cue[] = []
  let current: Cue | null = null

  const flush = () => {
    if (current?.text) cues.push(current)
    current = null
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines.at(index) ?? ''
    const trimmed = line.trim()
    if (!trimmed) {
      flush()
      continue
    }
    if (SKIPPED_LINE_PATTERN.test(trimmed)) continue

    if (trimmed.includes('-->')) {
      const [startRaw = '', endRaw = ''] = trimmed.split('-->')
      const startMs = parseTimecode(startRaw)
      if (startMs === null) continue
      flush()
      current = { startMs, endMs: parseTimecode(endRaw.trim().split(/\s+/)[0] ?? ''), text: '' }
      continue
    }

    const standalone = parseTimecode(trimmed)
    if (standalone !== null) {
      flush()
      current = { startMs: standalone, endMs: null, text: '' }
      continue
    }

    // SRT cue numbers sit directly above their timing line.
    const next = (lines.at(index + 1) ?? '').trim()
    if (/^\d+$/.test(trimmed) && next.includes('-->')) continue

    const text = cleanText(trimmed)
    if (!text) continue
    if (current) current.text = current.text ? `${current.text} ${text}` : text
    else current = { startMs: cues.length * DEFAULT_SEGMENT_MS, endMs: null, text }
  }
  flush()

  return cues
    .map((cue, index) => {
      const next = cues.at(index + 1)
      const endMs = cue.endMs ?? next?.startMs ?? cue.startMs + DEFAULT_SEGMENT_MS
      return {
        startMs: cue.startMs,
        durationMs: Math.max(endMs - cue.startMs, 0),
        text: cue.text
      }
    })
    .filter((segment) => segment.text.length > 0)
}

export function youtubeIdFromURL(value: string): string | null {
  const match = /(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/.exec(value.trim())
  return match?.[1] ?? null
}

export function transcriptFromCaptions(input: {
  captions: string
  url?: string
  title?: string
}): TutorialTranscript {
  const segments = parseCaptions(input.captions)
  if (segments.length === 0) {
    throw new Error(
      'No caption lines were found in that text. Paste the tutorial transcript again.'
    )
  }
  const url = input.url?.trim() ?? ''
  const videoId = youtubeIdFromURL(url) ?? 'pasted'
  return {
    videoId,
    sourceUrl: videoId === 'pasted' ? '' : `https://www.youtube.com/watch?v=${videoId}`,
    title: input.title?.trim() || 'Pasted tutorial transcript',
    creator: 'Pasted transcript',
    publishedAt: null,
    language: 'en',
    segments
  }
}
