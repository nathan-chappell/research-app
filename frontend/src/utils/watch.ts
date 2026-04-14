import type {
  WatchCaptureMode,
  WatchSessionState,
  WatchTargetMode,
} from '../types/models'

export const WATCH_CHUNK_MS = 5 * 60 * 1000

export type WatchChannelMessage =
  | {
      type: 'popup-ready'
    }
  | {
      type: 'request-state'
    }
  | {
      type: 'session-state'
      state: WatchSessionState
    }
  | {
      type: 'target-opened-directly'
      targetMode: WatchTargetMode
    }

export function watchChannelName(captureSessionId: string) {
  return `research-app:watch:${captureSessionId}`
}

export function normalizeWatchUrl(rawUrl: string) {
  const trimmed = rawUrl.trim()
  if (!trimmed) {
    throw new Error('Enter an http or https URL.')
  }

  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`
  const normalized = new URL(candidate)

  if (normalized.protocol !== 'http:' && normalized.protocol !== 'https:') {
    throw new Error('Only http and https URLs can be watched.')
  }

  return normalized.toString()
}

export function selectCaptureMimeType(mode: WatchCaptureMode) {
  if (typeof MediaRecorder === 'undefined') return ''

  const candidates =
    mode === 'audio'
      ? ['audio/webm;codecs=opus', 'audio/webm']
      : ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']

  if (typeof MediaRecorder.isTypeSupported !== 'function') {
    return candidates[candidates.length - 1]
  }

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? ''
}

export function extensionForMimeType(mimeType: string) {
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4')) return 'mp4'
  return 'webm'
}

export function watchUrlLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function sanitizeFilePart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'capture'
}

function watchTimestampLabel(value: string) {
  return value.replace(/[:.]/g, '-')
}

export function buildWatchChunkFileName(params: {
  normalizedUrl: string
  captureSessionId: string
  captureMode: WatchCaptureMode
  captureStartedAt: string
  captureChunkIndex: number
  mimeType: string
}) {
  const host = sanitizeFilePart(watchUrlLabel(params.normalizedUrl))
  const session = sanitizeFilePart(params.captureSessionId).slice(-8)
  const mode = params.captureMode === 'audio' ? 'audio' : 'audio-video'
  const extension = extensionForMimeType(params.mimeType)
  const chunkNumber = String(params.captureChunkIndex + 1).padStart(3, '0')
  const startedAt = sanitizeFilePart(watchTimestampLabel(params.captureStartedAt))

  return `${host}-${session}-${mode}-${startedAt}-part-${chunkNumber}.${extension}`
}

export function buildWatchChunkTitle(
  normalizedUrl: string,
  captureStartedAt: string,
  captureChunkIndex: number,
) {
  const source = watchUrlLabel(normalizedUrl)
  const startedAt = new Date(captureStartedAt).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return `${source} watch ${startedAt} part ${captureChunkIndex + 1}`
}
