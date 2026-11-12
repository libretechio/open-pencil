import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PORT = Number(process.env.PORT ?? 3000)
const YT_DLP_PATH = process.env.YT_DLP_PATH ?? 'yt-dlp'
const MAX_BODY_BYTES = 4096
const REQUEST_TIMEOUT_MS = Number(process.env.YOUTUBE_ATTEMPT_TIMEOUT_MS ?? 20_000)
// Discovery is a metadata read, so it gets a tighter ceiling: a hanging client must not
// consume the whole budget before the next fingerprint is tried.
const DISCOVERY_TIMEOUT_MS = Number(process.env.YOUTUBE_DISCOVERY_TIMEOUT_MS ?? 12_000)
const EXTRACTION_DEADLINE_MS = Number(process.env.YOUTUBE_DEADLINE_MS ?? 45_000)
// Breadth beats repetition: the ladder already covers five fingerprints, and a repeat
// on the same client mostly adds load, which YouTube answers with 429.
const ATTEMPTS_PER_CLIENT = Number(process.env.YOUTUBE_ATTEMPTS ?? 1)
const CACHE_TTL_MS = 60 * 60 * 1000
const CACHE_LIMIT = 50
// Repeated fetches of the same failing video make YouTube's answer worse, so a
// failure is remembered instead of retried on every click.
const FAILURE_TTL_MS = Number(process.env.YOUTUBE_FAILURE_TTL_MS ?? 10 * 60 * 1000)

const COOKIES_FILE = process.env.YOUTUBE_COOKIES_FILE ?? ''
const PROXY_URL = process.env.YOUTUBE_PROXY_URL ?? ''
// A PO token provider defeats YouTube's datacenter bot check without an account.
const PLUGIN_DIRS = process.env.YT_DLP_PLUGIN_DIRS ?? ''
const POT_BASE_URL = process.env.YT_DLP_POT_BASE_URL ?? ''

// YouTube bot-checks anonymous datacenter IPs unevenly across player clients, so a single
// extraction strategy fails intermittently. Each client is a different request fingerprint.
// Clients that hand out caption files without an extra token are tried first.
const DEFAULT_CLIENTS = 'android_vr,tv_simply,default,web_safari,web_embedded'
const PLAYER_CLIENTS = (process.env.YOUTUBE_PLAYER_CLIENTS ?? DEFAULT_CLIENTS)
  .split(',')
  .map((client) => client.trim())
  .filter(Boolean)

const transcriptCache = new Map()
const failureCache = new Map()
const inFlight = new Map()

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
  constructor(message, code, detail) {
    super(message)
    this.code = code
    this.detail = detail
  }
}

function classifyExtractionError(stderr) {
  if (/confirm you'?re not a bot|sign in to confirm|cookies/i.test(stderr)) return 'youtube-blocked'
  if (/429|too many requests|rate.?limit/i.test(stderr)) return 'rate-limited'
  if (/private video|video unavailable|has been removed|members-only/i.test(stderr))
    return 'video-unavailable'
  if (/no such video|does not exist|invalid video/i.test(stderr)) return 'video-unavailable'
  if (/no subtitles|there are no subtitles/i.test(stderr)) return 'no-captions'
  if (/did not get any data blocks|unable to download video data/i.test(stderr))
    return 'captions-failed'
  return 'extraction-failed'
}

function baseArgs(sourceUrl, client) {
  const args = [
    '--ignore-no-formats-error',
    '--no-warnings',
    '--no-playlist',
    '--socket-timeout',
    '10',
    '--retries',
    '1',
    '--add-header',
    'Accept-Language: en-US,en;q=0.9',
    '--extractor-args',
    `youtube:player_client=${client}${POT_BASE_URL ? ';fetch_pot=always' : ''}`,
    sourceUrl
  ]
  if (PLUGIN_DIRS) args.unshift('--plugin-dirs', PLUGIN_DIRS)
  if (POT_BASE_URL)
    args.unshift('--extractor-args', `youtubepot-bgutilhttp:base_url=${POT_BASE_URL}`)
  if (COOKIES_FILE) args.unshift('--cookies', COOKIES_FILE)
  if (PROXY_URL) args.unshift('--proxy', PROXY_URL)
  return args
}

/** Reads the caption track list without downloading anything. */
function discoverArgs(sourceUrl, client) {
  return ['--dump-single-json', '--skip-download', ...baseArgs(sourceUrl, client)]
}

/**
 * Downloads one exact caption track. A language wildcard also matches translated
 * variants (en-en, en-de-DE), and each extra track is another request that earns 429s.
 */
function captionArgs(sourceUrl, client, language, outputTemplate) {
  return [
    '--skip-download',
    '--write-subs',
    '--write-auto-subs',
    '--sub-langs',
    language,
    '--sub-format',
    'json3/srv3/vtt/best',
    '-o',
    outputTemplate,
    ...baseArgs(sourceUrl, client)
  ]
}

const ENGLISH_KEYS = ['en', 'en-orig', 'en-US', 'en-GB']

/** Picks an English track by name, never a translation such as en-de-DE. */
function chooseEnglishTrack(metadata) {
  const original = Object.keys(metadata.subtitles ?? {})
  const automatic = Object.keys(metadata.automatic_captions ?? {})
  const keys = [...new Set([...original, ...automatic])]
  for (const key of ENGLISH_KEYS) {
    if (keys.includes(key)) return { language: key, keys, source: original.includes(key) ? 'human' : 'auto' }
  }
  const simple = keys.find((key) => /^en(-[A-Z]{2})?$/.test(key))
  if (simple)
    return { language: simple, keys, source: original.includes(simple) ? 'human' : 'auto' }
  return { language: null, keys, source: null }
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

function timecodeToMs(value) {
  const parts = value.trim().replace(',', '.').split(':')
  if (parts.length < 2) return null
  const seconds = Number(parts.at(-1))
  const minutes = Number(parts.at(-2))
  const hours = parts.length > 2 ? Number(parts.at(-3)) : 0
  if (![seconds, minutes, hours].every(Number.isFinite)) return null
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000)
}

function segmentsFromVtt(vtt) {
  const segments = []
  const blocks = vtt.replace(/\r/g, '').split('\n\n')
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean)
    const timingIndex = lines.findIndex((line) => line.includes('-->'))
    if (timingIndex === -1) continue
    const startMs = timecodeToMs(lines[timingIndex].split('-->')[0] ?? '')
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

function parseCaptionFile(name, body) {
  if (name.endsWith('.json3')) return segmentsFromJson3(JSON.parse(body))
  if (name.endsWith('.srv3') || name.endsWith('.xml')) return segmentsFromSrv3(body)
  return segmentsFromVtt(body)
}

// Prefer the original English track, then ASR English, then whatever yt-dlp wrote.
function captionFileOrder(names) {
  const rank = (name) => {
    if (name.endsWith('.en.json3')) return 0
    if (name.endsWith('.json3')) return 1
    if (name.endsWith('.en.srv3') || name.endsWith('.en.xml')) return 2
    if (name.endsWith('.srv3') || name.endsWith('.xml')) return 3
    if (name.endsWith('.en.vtt')) return 4
    return 5
  }
  return [...names].sort((a, b) => rank(a) - rank(b))
}

function publishedDate(value) {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return null
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

async function readCaptions(directory) {
  const names = await readdir(directory)
  const candidates = captionFileOrder(names.filter((name) => !name.endsWith('.part')))
  for (const name of candidates) {
    if (name === 'meta.txt') continue
    try {
      const body = await readFile(join(directory, name), 'utf8')
      const segments = parseCaptionFile(name, body)
      if (segments.length > 0) return { segments, name }
    } catch {
      continue
    }
  }
  return { segments: [], name: null }
}

function metaFrom(metadata, videoId) {
  return {
    id: videoId,
    title: metadata.title || 'YouTube tutorial',
    creator: metadata.uploader || metadata.channel || 'Unknown creator',
    publishedAt: publishedDate(metadata.upload_date)
  }
}

async function discover(sourceUrl, client) {
  const { stdout } = await execFileAsync(YT_DLP_PATH, discoverArgs(sourceUrl, client), {
    timeout: DISCOVERY_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024
  })
  return JSON.parse(stdout)
}

async function attemptWithClient(sourceUrl, client, videoId) {
  const metadata = await discover(sourceUrl, client)
  const { language, keys } = chooseEnglishTrack(metadata)
  if (!language) return { ok: false, code: 'no-captions', tracks: keys }

  const directory = await mkdtemp(join(tmpdir(), 'libretech-tutorial-'))
  try {
    await execFileAsync(
      YT_DLP_PATH,
      captionArgs(sourceUrl, client, language, join(directory, '%(id)s.%(ext)s')),
      { timeout: REQUEST_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }
    )
    const { segments } = await readCaptions(directory)
    if (segments.length === 0)
      return { ok: false, code: 'captions-failed', tracks: keys, language }
    return { ok: true, segments, language, meta: metaFrom(metadata, videoId) }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
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
  failureCache.delete(key)
  while (transcriptCache.size > CACHE_LIMIT) {
    transcriptCache.delete(transcriptCache.keys().next().value)
  }
}

function failureGet(key) {
  const hit = failureCache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > FAILURE_TTL_MS) {
    failureCache.delete(key)
    return null
  }
  return { ...hit, retryAfterSeconds: Math.ceil((hit.at + FAILURE_TTL_MS - Date.now()) / 1000) }
}

function failureSet(key, code, message) {
  failureCache.set(key, { at: Date.now(), code, message })
  while (failureCache.size > CACHE_LIMIT) {
    failureCache.delete(failureCache.keys().next().value)
  }
}

async function transcriptFor(rawUrl) {
  const videoId = youtubeId(rawUrl)
  const cached = cacheGet(videoId)
  if (cached) return cached
  const known = failureGet(videoId)
  if (known) {
    throw new TranscriptError(known.message, known.code, {
      cachedFailure: true,
      retryAfterSeconds: known.retryAfterSeconds
    })
  }
  const running = inFlight.get(videoId)
  if (running) return running
  const attempt = extractTranscript(videoId).finally(() => inFlight.delete(videoId))
  inFlight.set(videoId, attempt)
  return attempt
}

async function extractTranscript(videoId) {
  const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`
  const started = Date.now()
  const failures = []
  let deadlineHit = false
  let lastTracks = []

  for (const client of PLAYER_CLIENTS) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_CLIENT; attempt += 1) {
      if (Date.now() - started > EXTRACTION_DEADLINE_MS) {
        deadlineHit = true
        break
      }
      try {
        const result = await attemptWithClient(sourceUrl, client, videoId)
        lastTracks = result.tracks ?? lastTracks
        if (result.ok) {
          console.log(
            `transcript via ${client} (attempt ${attempt}), ${result.segments.length} segments`
          )
          const transcript = {
            videoId,
            sourceUrl,
            title: result.meta.title,
            creator: result.meta.creator,
            publishedAt: result.meta.publishedAt,
            language: 'en',
            segments: result.segments
          }
          cacheSet(videoId, transcript)
          return transcript
        }
        failures.push({ client, code: result.code ?? 'no-captions', tracks: result.tracks })
        if (result.code === 'captions-failed') break
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
        if (code === 'no-captions' || code === 'video-unavailable') break
        if (attempt < ATTEMPTS_PER_CLIENT) await new Promise((r) => setTimeout(r, 1200 * attempt))
      }
    }
    if (Date.now() - started > EXTRACTION_DEADLINE_MS) {
      deadlineHit = true
      break
    }
  }

  const codes = new Set(failures.map((failure) => failure.code))
  const detail = {
    attempts: failures,
    deadlineHit,
    elapsedMs: Date.now() - started,
    captionTracks: lastTracks
  }
  console.warn('transcript extraction failed', JSON.stringify(detail))

  if (codes.size === 1 && codes.has('no-captions')) {
    const message =
      lastTracks.length === 0
        ? 'YouTube returned no caption tracks for this video to this server. Paste the transcript instead.'
        : 'This video has no English captions that the tutor can read. Paste the transcript instead.'
    failureSet(videoId, 'no-captions', message)
    throw new TranscriptError(message, 'no-captions', detail)
  }
  if (codes.size === 1 && codes.has('rate-limited')) {
    failureSet(
      videoId,
      'rate-limited',
      'YouTube is rate-limiting caption downloads from this server. Wait a minute and try again, or paste the transcript.'
    )
    throw new TranscriptError(
      'YouTube is rate-limiting caption downloads from this server. Wait a minute and try again, or paste the transcript.',
      'rate-limited',
      detail
    )
  }
  if (codes.size === 1 && codes.has('captions-failed')) {
    throw new TranscriptError(
      "YouTube returned this video's player but not its caption file. Paste the transcript instead, or try again shortly.",
      'captions-failed',
      detail
    )
  }
  if (deadlineHit) {
    failureSet(
      videoId,
      'timeout',
      'YouTube took too long to answer. Try again, or paste the transcript to skip the wait.'
    )
    throw new TranscriptError(
      'YouTube took too long to answer. Try again, or paste the transcript to skip the wait.',
      'timeout',
      detail
    )
  }
  const blocked =
    "YouTube is refusing this server's transcript requests right now. Paste the video's transcript below and the tutor will build the same lesson."
  failureSet(videoId, 'youtube-blocked', blocked)
  throw new TranscriptError(blocked, 'youtube-blocked', detail)
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
      potProvider: POT_BASE_URL || null,
      pluginDirs: PLUGIN_DIRS || null,
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
    const detail = error instanceof TranscriptError ? (error.detail ?? null) : null
    json(response, code === 'invalid-request' ? 400 : 422, { error: message, code, detail })
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(
    `Tutorial transcript service listening on ${PORT} (clients: ${PLAYER_CLIENTS.join(', ')})`
  )
})
