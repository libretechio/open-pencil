import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PORT = Number(process.env.PORT ?? 3000)
const YT_DLP_PATH = process.env.YT_DLP_PATH ?? 'yt-dlp'
const MAX_BODY_BYTES = 4096
const REQUEST_TIMEOUT_MS = 20_000

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

function captionTrack(metadata) {
  const tracks = metadata.subtitles?.en ?? metadata.automatic_captions?.en
  if (!Array.isArray(tracks))
    throw new Error('This video has no English captions that the tutor can read.')
  return tracks.find((track) => track.ext === 'json3') ?? tracks[0]
}

function publishedDate(value) {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return null
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

async function metadataFor(sourceUrl) {
  const { stdout } = await execFileAsync(
    YT_DLP_PATH,
    ['--dump-single-json', '--skip-download', '--no-warnings', sourceUrl],
    { timeout: REQUEST_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }
  )
  return JSON.parse(stdout)
}

async function transcriptFor(rawUrl) {
  const videoId = youtubeId(rawUrl)
  const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`
  const metadata = await metadataFor(sourceUrl)
  const track = captionTrack(metadata)
  const response = await fetch(track.url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`YouTube captions returned ${response.status}.`)
  const captions = await response.json()
  const segments = (captions.events ?? [])
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
  if (segments.length === 0) throw new Error('YouTube returned captions without readable text.')
  return {
    videoId,
    sourceUrl,
    title: metadata.title ?? 'YouTube tutorial',
    creator: metadata.uploader ?? metadata.channel ?? 'Unknown creator',
    publishedAt: publishedDate(metadata.upload_date),
    language: track.name ?? 'en',
    segments
  }
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
  if (request.method !== 'POST' || request.url !== '/api/tutorials/transcript') {
    json(response, 404, { error: 'Not found.' })
    return
  }
  try {
    const input = await body(request)
    json(response, 200, await transcriptFor(input.url))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    json(response, 400, { error: message })
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Tutorial transcript service listening on ${PORT}`)
})
