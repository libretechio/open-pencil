import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PORT = Number(process.env.PORT ?? 3000)
const YT_DLP_PATH = process.env.YT_DLP_PATH ?? 'yt-dlp'
const MAX_BODY_BYTES = 4096
const REQUEST_TIMEOUT_MS = 20_000
const EXTRACTION_DEADLINE_MS = Number(process.env.YOUTUBE_DEADLINE_MS ?? 30_000)
const ATTEMPTS_PER_CLIENT = Number(process.env.YOUTUBE_ATTEMPTS ?? 2)
const CACHE_TTL_MS = 60 * 60 * 1000
const CACHE_LIMIT = 50

// YouTube bot-checks anonymous datacenter IPs unevenly across player clients, so a single
// extraction strategy fails intermittently. Each client is a different request fingerprint.
const PLAYER_CLIENTS = (
  process.env.YOUTUBE_PLAYER_CLIENTS ?? 'default,android_vr,web_safari,tv_simply,web_embedded'
)
  .split(',')
  .map((client) => client.trim())
  .filter(Boolean)
const COOKIES_FILE = process.env.YOUTUBE_COOKIES_FILE ?? ''
const PROXY_URL = process.env.YOUTUBE_PROXY_URL ?? ''

const transcriptCache = new Map()

function youtubeId(rawUrl) {
  const url = new URL(rawUrl)
  const host = url.hostname.replace(/^www\./, '')
  let id = ''
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0] ?? ''
  else if (host === 'youtube.com' || host === 'm.youtube.com') {
    id =
      url.pathname === '/watch'
        ? (url.searchParams.get('v') ?? '')
        : (url.pathname.split('/').at(-1) ?? '')
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error('Enter a valid YouTube video URL.')
  return id
}

class TranscriptError extends Error {
  constructor(message, code) {
    super(message)
    this.code = code
  }
}

function classifyExtractionError(stderr) {
  if (/confirm you'?re not a bot|sign in to confirm|cookies/i.test(stderr)) return 'youtube-blocked'
  if (/429|too many requests|rate.?limit/i.test(stderr)) return 'youtube-blocked'
  if (/private video|video unavailable|has been removed|members-only/i.test(stderr))
    return 'video-unavailable'
  if (/no such video|does not exist|invalid video/i.test(stderr)) return 'video-unavailable'
  return 'extraction-failed'
}

function ytDlpArgs(sourceUrl, client) {
  const args = [
    '--dump-single-json',
    '--skip-download',
    '--no-warnings',
    '--no-playlist',
    '--ignore-no-formats-error',
    '--socket-timeout',
    '10',
    '--retries',
    '1',
    '--extractor-args',
    `youtube:player_client=${client}`,
    sourceUrl
  ]
  if (COOKIES_FILE) args.unshift('--cookies', COOKIES_FILE)
  if (PROXY_URL) args.unshift('--proxy', PROXY_URL)
  return args
}

async function metadataWithClient(sourceUrl, client) {
  const { stdout } = await execFileAsync(YT_DLP_PATH, ytDlpArgs(sourceUrl, client), {
    timeout: REQUEST_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024
  })
  return JSON.parse(stdout)
}

function hasCaptions(metadata) {
  return Array.isArray(metadata.subtitles?.en) || Array.isArray(metadata.automatic_captions?.en)
}

async function metadataFor(sourceUrl) {
  const started = Date.now()
  const failures = []
  for (const client of PLAYER_CLIENTS) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_CLIENT; attempt += 1) {
      if (Date.now() - started > EXTRACTION_DEADLINE_MS) break
      try {
        const metadata = await metadataWithClient(sourceUrl, client)
        if (hasCaptions(metadata)) {
          console.log(`transcript metadata via ${client} (attempt ${attempt})`)
          return metadata
        }
        failures.push({ client, code: 'no-captions', message: 'no English captions' })
        break
      } catch (error) {
        const stderr = `${error?.stderr ?? ''} ${error?.message ?? ''}`
        const code = classifyExtractionError(stderr)
        failures.push({ client, code, message: stderr.trim().split('\n').at(-1)?.slice(0, 200) })
        if (code === 'video-unavailable') {
          throw new TranscriptError(
            'This video is unavailable or private, so the tutor cannot read its captions.',
            code
          )
        }
        if (attempt < ATTEMPTS_PER_CLIENT) await new Promise((r) => setTimeout(r, 1200 * attempt))
      }
    }
    if (Date.now() - started > EXTRACTION_DEADLINE_MS) break
  }
  if (failures.some((failure) => failure.code === 'no-captions')) {
    throw new TranscriptError(
      'This video has no English captions that the tutor can read. Paste the transcript instead.',
      'no-captions'
    )
  }
  console.warn('transcript extraction failed', JSON.stringify(failures))
  throw new TranscriptError(
    "YouTube is refusing this server's transcript requests right now. Paste the video's transcript below and the tutor will build the same lesson.",
    'youtube-blocked'
  )
}

function captionTrack(metadata) {
  const tracks = metadata.subtitles?.en ?? metadata.automatic_captions?.en
  if (!Array.isArray(tracks)) return null
  return (
    tracks.find((track) => track.ext === 'json3') ??
    tracks.find((track) => track.ext === 'srv3') ??
    tracks.find((track) => track.ext === 'vtt') ??
    tracks[0]
  )
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function segmentsFromJson3(captions) {
  return (captions.events ?? [])
    .filter((event) => Array.isArray(event.segs) && Number.isFinite(event.tStartMs))
    .map((event) => ({
      startMs: event.tStartMs,
      durationMs: event.dDurationMs ?? 0,
      text: event.segs
        .map((part) => part.utf8 ?? '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
    }))
    .filter((segment) => segment.text.length > 0)
}

function segmentsFromSrv3(xml) {
  const segments = []
  const pattern = /<p\b([^>]*)>([\s\S]*?)<\/p>/g
  for (const match of xml.matchAll(pattern)) {
    const startMs = Number(/\bt="(\d+)"/.exec(match[1] ?? '')?.[1] ?? Number.NaN)
    if (!Number.isFinite(startMs)) continue
    const durationMs = Number(/\bd="(\d+)"/.exec(match[1] ?? '')?.[1] ?? 0)
    const text = decodeEntities(
      (match[2] ?? '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
    if (text) segments.push({ startMs, durationMs, text })
  }
  return segments
}

function segmentsFromVtt(vtt) {
  const segments = []
  const blocks = vtt.replace(/\r/g, '').split('\n\n')
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean)
    const timingIndex = lines.findIndex((line) => line.includes('-->'))
    if (timingIndex === -1) continue
    const start = lines[timingIndex].split('-->')[0]?.trim() ?? ''
    const startMs = timecodeToMs(start)
    if (startMs === null) continue
    const text = decodeEntities(
      lines
        .slice(timingIndex + 1)
        .join(' ')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
    if (text) segments.push({ startMs, durationMs: 0, text })
  }
  return segments
}

function timecodeToMs(value) {
  const parts = value.trim().replace(',', '.').split(':')
  if (parts.length < 2) return null
  const seconds = Number(parts.at(-1))
  const minutes = Number(parts.at(-2))
  const hours = parts.length > 2 ? Number(parts.at(-3)) : 0
  if (![seconds, minutes, hours].every(Number.isFinite)) return null
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000)
}

async function captionsFor(track) {
  const formats = ['json3', 'srv3', 'vtt']
  const preferred = track.ext && formats.includes(track.ext) ? track.ext : 'json3'
  const ordered = [preferred, ...formats.filter((format) => format !== preferred)]
  for (const format of ordered) {
    const base = track.url.replace(/&fmt=[a-z0-9]+/i, '')
    const url = `${base}&fmt=${format}`
    try {
      const response = await fetch(url, {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'accept-language': 'en-US,en;q=0.9'
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      if (!response.ok) continue
      const body = await response.text()
      if (!body.trim()) continue
      const segments =
        format === 'json3'
          ? segmentsFromJson3(JSON.parse(body))
          : format === 'srv3'
            ? segmentsFromSrv3(body)
            : segmentsFromVtt(body)
      if (segments.length > 0) return segments
    } catch {
      continue
    }
  }
  return []
}

function publishedDate(value) {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return null
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

function cacheGet(key) {
  const hit = transcriptCache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    transcriptCache.delete(key)
    return null
  }
  return hit.value
}

function cacheSet(key, value) {
  transcriptCache.set(key, { at: Date.now(), value })
  while (transcriptCache.size > CACHE_LIMIT) {
    transcriptCache.delete(transcriptCache.keys().next().value)
  }
}

async function transcriptFor(rawUrl) {
  const videoId = youtubeId(rawUrl)
  const cached = cacheGet(videoId)
  if (cached) return cached
  const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`
  const metadata = await metadataFor(sourceUrl)
  const track = captionTrack(metadata)
  if (!track) {
    throw new TranscriptError(
      'This video has no English captions that the tutor can read. Paste the transcript instead.',
      'no-captions'
    )
  }
  const segments = await captionsFor(track)
  if (segments.length === 0) {
    throw new TranscriptError(
      "YouTube did not return readable captions for this video. Paste the video's transcript and the tutor will build the same lesson.",
      'youtube-blocked'
    )
  }
  const transcript = {
    videoId,
    sourceUrl,
    title: metadata.title ?? 'YouTube tutorial',
    creator: metadata.uploader ?? metadata.channel ?? 'Unknown creator',
    publishedAt: publishedDate(metadata.upload_date),
    language: track.name ?? 'en',
    segments
  }
  cacheSet(videoId, transcript)
  return transcript
}

function json(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  response.end(JSON.stringify(body))
}

async function body(request) {
  const chunks = []
  let length = 0
  for await (const chunk of request) {
    length += chunk.length
    if (length > MAX_BODY_BYTES) throw new Error('Request is too large.')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('ok\n')
    return
  }
  if (request.method === 'GET' && request.url === '/api/tutorials/status') {
    json(response, 200, {
      clients: PLAYER_CLIENTS,
      cookies: Boolean(COOKIES_FILE),
      proxy: Boolean(PROXY_URL),
      cached: transcriptCache.size
    })
    return
  }
  if (request.method !== 'POST' || request.url !== '/api/tutorials/transcript') {
    json(response, 404, { error: 'Not found.' })
    return
  }
  try {
    const input = await body(request)
    json(response, 200, await transcriptFor(input.url))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = error instanceof TranscriptError ? error.code : 'invalid-request'
    json(response, code === 'invalid-request' ? 400 : 422, { error: message, code })
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(
    `Tutorial transcript service listening on ${PORT} (clients: ${PLAYER_CLIENTS.join(', ')})`
  )
})
