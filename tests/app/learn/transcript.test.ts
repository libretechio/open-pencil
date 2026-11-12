import { describe, expect, test } from 'bun:test'

import { compileTutorialLesson } from '@/app/learn/compiler'
import { parseCaptions, parseTimecode, transcriptFromCaptions } from '@/app/learn/transcript'

describe('Pasted caption parsing', () => {
  test('reads the YouTube transcript panel copy with minute timestamps', () => {
    const segments = parseCaptions(
      ['0:04', 'select both cards and add auto layout', '0:12', 'set the gap to 16'].join('\n')
    )
    expect(segments).toEqual([
      { startMs: 4000, durationMs: 8000, text: 'select both cards and add auto layout' },
      { startMs: 12000, durationMs: 4000, text: 'set the gap to 16' }
    ])
  })

  test('reads WebVTT cues and drops headers, tags, and entity escapes', () => {
    const segments = parseCaptions(
      [
        'WEBVTT',
        'Kind: captions',
        '',
        '00:00:01.000 --> 00:00:03.500',
        '<v Speaker>Set the <b>padding</b> to 24 &amp; keep it even</v>',
        '',
        '00:00:03.500 --> 00:00:06.000',
        'then check the gap'
      ].join('\n')
    )
    expect(segments).toEqual([
      { startMs: 1000, durationMs: 2500, text: 'Set the padding to 24 & keep it even' },
      { startMs: 3500, durationMs: 2500, text: 'then check the gap' }
    ])
  })

  test('reads SRT cue numbers without treating them as caption text', () => {
    const segments = parseCaptions(
      [
        '1',
        '00:00:02,000 --> 00:00:05,000',
        'Use horizontal padding 24',
        '',
        '2',
        '00:00:05,000 --> 00:00:08,000',
        'and vertical padding 16'
      ].join('\n')
    )
    expect(segments).toHaveLength(2)
    expect(segments[0]).toEqual({
      startMs: 2000,
      durationMs: 3000,
      text: 'Use horizontal padding 24'
    })
  })

  test('falls back to spaced segments for prose with no timings', () => {
    const segments = parseCaptions('Select the frame and add auto layout.')
    expect(segments).toEqual([
      { startMs: 0, durationMs: 4000, text: 'Select the frame and add auto layout.' }
    ])
  })

  test('parses hour, minute, and second timecodes', () => {
    expect(parseTimecode('1:02:03.250')).toBe(3_723_250)
    expect(parseTimecode('02:03,500')).toBe(123_500)
    expect(parseTimecode('not a time')).toBeNull()
  })
})

describe('Lesson from a pasted transcript', () => {
  test('compiles the same verifiable checkpoints as the YouTube path', () => {
    const transcript = transcriptFromCaptions({
      url: 'https://www.youtube.com/watch?v=1odqpkfkDL8',
      captions: [
        '0:04',
        'add auto layout and make it a vertical stack',
        '0:12',
        'set the gap to 16'
      ].join('\n')
    })
    expect(transcript.videoId).toBe('1odqpkfkDL8')
    expect(transcript.sourceUrl).toBe('https://www.youtube.com/watch?v=1odqpkfkDL8')
    const lesson = compileTutorialLesson(transcript)
    expect(lesson.steps[0]?.verification).toMatchObject({
      kind: 'selected-auto-layout',
      direction: 'VERTICAL',
      gap: 16
    })
  })

  test('keeps a lesson without a video when no URL is given', () => {
    const transcript = transcriptFromCaptions({ captions: 'add auto layout, gap 8' })
    expect(transcript.videoId).toBe('pasted')
    expect(transcript.sourceUrl).toBe('')
  })

  test('rejects empty pasted text', () => {
    expect(() => transcriptFromCaptions({ captions: '   \n  ' })).toThrow('No caption lines')
  })
})
