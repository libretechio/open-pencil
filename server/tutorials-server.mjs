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
const REQUEST_TIMEOUT_MS = 20_000
const EXTRACTION_DEADLINE_MS = Number(process.env.YOUTUBE_DEADLINE_MS ?? 30_000)
const ATTEMPTS_PER_CLIENT = Number(process.env.YOUTUBE_ATTEMPTS ?? 2)
const CACHE_TTL_MS = 60 * 60 * 1000
const CACHE_LIMIT = 50

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
  if (/no subtitles|did not get any data blocks/i.test(stderr)) return 'no-captions'
  return 'extraction-failed'
}

function ytDlpArgs(sourceUrl, client, outputTemplate, metaPath) {
  const args = [
    '--skip-download',
    '--ignore-no-formats-error',
    '--no-warnings',
    '--no-playlist',
    '--socket-timeout',
    '10',
    '--retries',
    '1',
    '--write-subs',
    '--write-auto-subs',
    '--sub-langs',
    'en.*,en',
    '--sub-format',
    'json3/srv3/vtt/best',
    '--print-to-file',
    '%(title)s\t%(uploader)s\t%(upload_date)s\t%(id)s',
    metaPath,
    '--extractor-args',
    `youtube:player_client=${client}${POT_BASE_URL ? ';fetch_pot=always' : ''}`,
    '-o',
    outputTemplate,
    sourceUrl
  ]
  if (PLUGIN_DIRS) args.unshift('--plugin-dirs', PLUGIN_DIRS)
  if (POT_BASE_URL) args.unshift('--extractor-args', `youtubepot-bgutilhttp:base_url=${POT_BASE_URL}`)
  if (COOKIES_FILE) args.unshift('--cookies', COOKIES_FILE)
  if (PROXY_URL) args.unshift('--proxy', PROXY_URL)
  return args
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

async function readMeta(directory, videoId) {
  try {
    const raw = await readFile(join(directory, 'meta.txt'), 'utf8')
    const [title, creator, uploadDate, id] = raw.trim().split('\t')
    return {
      title: title || 'YouTube tutorial',
      creator: creator || 'Unknown creator',
      publishedAt: publishedDate(uploadDate),
      id: id || videoId
    }
  } catch {
    return { title: 'YouTube tutorial', creator: 'Unknown creator', publishedAt: null, id: videoId }
  }
}

async function attemptWithClient(sourceUrl, client, videoId) {
  const directory = await mkdtemp(join(tmpdir(), 'libretech-tutorial-'))
  const metaPath = join(directory, 'meta.txt')
  const outputTemplate = join(directory, '%(id)s.%(ext)s')
  try {
    await execFileAsync(YT_DLP_PATH, ytDlpArgs(sourceUrl, client, outputTemplate, metaPath), {
      timeout: REQUEST_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024
    })
    const { segments } = await readCaptions(directory)
    if (segments.length === 0) return { ok: false, segments }
    return { ok: true, segments, meta: await readMeta(directory, videoId) }
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
  while (transcriptCache.size > CACHE_LIMIT) {
    transcriptCache.delete(transcriptCache.keys().next().value)
  }
}

async function transcriptFor(rawUrl) {
  const videoId = youtubeId(rawUrl)
  const cached = cacheGet(videoId)
  if (cached) return cached
  const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`
  const started = Date.now()
  const failures = []
  let sawNoCaptions = false

  for (const client of PLAYER_CLIENTS) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_CLIENT; attempt += 1) {
      if (Date.now() - started > EXTRACTION_DEADLINE_MS) break
      try {
        const result = await attemptWithClient(sourceUrl, client, videoId)
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
        sawNoCaptions = true
        failures.push({ client, code: 'no-captions' })
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
        if (code === 'no-captions') {
          sawNoCaptions = true
          break
        }
        if (attempt < ATTEMPTS_PER_CLIENT) await new Promise((r) => setTimeout(r, 1200 * attempt))
      }
    }
    if (Date.now() - started > EXTRACTION_DEADLINE_MS) break
  }

  if (sawNoCaptions && failures.every((failure) => failure.code === 'no-captions')) {
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
    json(response, code === 'invalid-request' ? 400 : 422, { error: message, code })
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(
    `Tutorial transcript service listening on ${PORT} (clients: ${PLAYER_CLIENTS.join(', ')})`
  )
})
