import {
  Badge,
  Box,
  Button,
  Code,
  Group,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useMemo, useRef, useState } from 'react'

import { db } from '../db/schema'
import type { ApiClient } from '../services/api'
import { type ImportLocalMediaOptions, importLocalMedia } from '../services/media'
import type {
  IngestionJob,
  SemanticCapabilities,
  WatchCaptureMode,
  WatchPopupStatus,
  WatchRecordingStatus,
  WatchSessionState,
  WatchTargetMode,
} from '../types/models'
import { makeId } from '../utils/id'
import { formatTimestamp } from '../utils/time'
import {
  WATCH_CHUNK_MS,
  buildWatchChunkFileName,
  buildWatchChunkTitle,
  normalizeWatchUrl,
  selectCaptureMimeType,
  watchChannelName,
  type WatchChannelMessage,
} from '../utils/watch'

interface WatchPaneProps {
  api: ApiClient
  libraryId: string
  semanticCapabilities: SemanticCapabilities
  onCaptureImported?: (corpusItemId: string) => void
}

interface FinalizedChunk {
  blob: Blob | null
  mimeType: string
  chunkIndex: number
  chunkStartedAt: string
}

interface ActiveRecorder {
  recorder: MediaRecorder
  chunkIndex: number
  chunkStartedAt: string
  stopPromise: Promise<FinalizedChunk>
}

function finalizeChunkMimeType(recorder: MediaRecorder, fallbackMimeType: string, blob: Blob | null) {
  return recorder.mimeType || blob?.type || fallbackMimeType
}

function buildCaptureStream(sourceStream: MediaStream, captureMode: WatchCaptureMode) {
  const audioTracks = sourceStream.getAudioTracks()
  const videoTracks = sourceStream.getVideoTracks()

  if (captureMode === 'audio') {
    if (audioTracks.length === 0) {
      throw new Error('The selected tab or window is not sharing audio.')
    }
    return new MediaStream(audioTracks)
  }

  if (videoTracks.length === 0) {
    throw new Error('The selected capture surface does not include a video track.')
  }

  return new MediaStream([...videoTracks, ...audioTracks])
}

function watchPopupLabel(status: WatchPopupStatus) {
  switch (status) {
    case 'ready':
      return 'popup ready'
    case 'opening':
      return 'opening popup'
    case 'blocked':
      return 'popup blocked'
    default:
      return 'popup closed'
  }
}

function watchRecordingLabel(status: WatchRecordingStatus) {
  switch (status) {
    case 'capturing':
      return 'recording'
    case 'stopping':
      return 'stopping'
    case 'error':
      return 'error'
    default:
      return 'idle'
  }
}

export function WatchPane({
  api,
  libraryId,
  semanticCapabilities,
  onCaptureImported,
}: WatchPaneProps) {
  const [captureSessionId] = useState(() => makeId('watch'))
  const [targetUrl, setTargetUrl] = useState('')
  const [normalizedUrl, setNormalizedUrl] = useState<string>()
  const [captureMode, setCaptureMode] = useState<WatchCaptureMode>('audio')
  const [targetMode, setTargetMode] = useState<WatchTargetMode>('iframe')
  const [popupStatus, setPopupStatus] = useState<WatchPopupStatus>('closed')
  const [recordingStatus, setRecordingStatus] = useState<WatchRecordingStatus>('idle')
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0)
  const [chunkStartedAt, setChunkStartedAt] = useState<string>()
  const [captureStartedAt, setCaptureStartedAt] = useState<string>()
  const [pendingImports, setPendingImports] = useState(0)
  const [importedChunks, setImportedChunks] = useState(0)
  const [error, setError] = useState<string>()
  const [tick, setTick] = useState(() => Date.now())

  const popupRef = useRef<Window | null>(null)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const sourceStreamRef = useRef<MediaStream | null>(null)
  const activeRecorderRef = useRef<ActiveRecorder | null>(null)
  const rotationTimerRef = useRef<number | null>(null)
  const importQueueRef = useRef(Promise.resolve())
  const isRotatingRef = useRef(false)
  const isStoppingRef = useRef(false)
  const captureActiveRef = useRef(false)
  const chunkIndexRef = useRef(0)
  const normalizedUrlRef = useRef<string | undefined>(undefined)
  const sessionStartedAtRef = useRef<string | undefined>(undefined)
  const sessionCaptureModeRef = useRef<WatchCaptureMode>('audio')

  useEffect(() => {
    normalizedUrlRef.current = normalizedUrl
  }, [normalizedUrl])

  useEffect(() => {
    const channel = new BroadcastChannel(watchChannelName(captureSessionId))
    channelRef.current = channel
    channel.onmessage = (event: MessageEvent<WatchChannelMessage>) => {
      if (event.data.type === 'popup-ready') {
        setPopupStatus('ready')
        channel.postMessage({ type: 'session-state', state: sessionStateRef.current })
        return
      }

      if (event.data.type === 'request-state') {
        channel.postMessage({ type: 'session-state', state: sessionStateRef.current })
        return
      }

      if (event.data.type === 'target-opened-directly') {
        setTargetMode(event.data.targetMode)
      }
    }

    return () => {
      channel.close()
      channelRef.current = null
    }
  }, [captureSessionId])

  useEffect(() => {
    if (!chunkStartedAt) return undefined
    setTick(Date.now())
    const timer = window.setInterval(() => setTick(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [chunkStartedAt])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (popupRef.current && popupRef.current.closed) {
        popupRef.current = null
        setPopupStatus('closed')
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(
    () => () => {
      if (rotationTimerRef.current) {
        window.clearTimeout(rotationTimerRef.current)
      }
      if (sourceStreamRef.current) {
        sourceStreamRef.current.getTracks().forEach((track) => track.stop())
      }
    },
    [],
  )

  const sessionState = useMemo<WatchSessionState>(
    () => ({
      captureSessionId,
      targetUrl,
      normalizedUrl,
      targetMode,
      captureMode,
      popupStatus,
      recordingStatus,
      currentChunkIndex,
      chunkStartedAt,
      captureStartedAt,
      pendingImports,
      importedChunks,
      error,
    }),
    [
      captureMode,
      captureSessionId,
      captureStartedAt,
      chunkStartedAt,
      currentChunkIndex,
      error,
      importedChunks,
      normalizedUrl,
      pendingImports,
      popupStatus,
      recordingStatus,
      targetMode,
      targetUrl,
    ],
  )

  const sessionStateRef = useRef(sessionState)

  useEffect(() => {
    sessionStateRef.current = sessionState
    channelRef.current?.postMessage({ type: 'session-state', state: sessionState })
  }, [sessionState])

  const currentChunkElapsed = chunkStartedAt
    ? Math.max(0, tick - new Date(chunkStartedAt).getTime())
    : 0

  const resetRotationTimer = () => {
    if (rotationTimerRef.current) {
      window.clearTimeout(rotationTimerRef.current)
      rotationTimerRef.current = null
    }
  }

  const queueImport = (chunk: FinalizedChunk) => {
    if (!chunk.blob || chunk.blob.size === 0) {
      return
    }

    const activeUrl = normalizedUrlRef.current
    const activeCaptureStartedAt = sessionStartedAtRef.current
    if (!activeUrl || !activeCaptureStartedAt) {
      return
    }

    setPendingImports((count) => count + 1)

    const performImport = async () => {
      try {
        const blob = chunk.blob
        if (!blob) {
          return
        }
        const mimeType =
          chunk.mimeType || (sessionCaptureModeRef.current === 'audio' ? 'audio/webm' : 'video/webm')
        const fileName = buildWatchChunkFileName({
          normalizedUrl: activeUrl,
          captureSessionId,
          captureMode: sessionCaptureModeRef.current,
          captureStartedAt: activeCaptureStartedAt,
          captureChunkIndex: chunk.chunkIndex,
          mimeType,
        })
        const title = buildWatchChunkTitle(activeUrl, activeCaptureStartedAt, chunk.chunkIndex)
        const file = new File([blob], fileName, {
          type: mimeType,
          lastModified: Date.now(),
        })
        const importOptions: ImportLocalMediaOptions = {
          title,
          sourceFileName: fileName,
          sourceKind: 'watch_capture',
          sourceUrl: activeUrl,
          captureSessionId,
          captureChunkIndex: chunk.chunkIndex,
          captureMode: sessionCaptureModeRef.current,
          captureStartedAt: activeCaptureStartedAt,
        }

        const result = await importLocalMedia(
          api,
          libraryId,
          semanticCapabilities,
          file,
          async (job) => {
            if (job.id) {
              await db.ingestionJobs.put(job as IngestionJob)
            }
          },
          importOptions,
        )

        setImportedChunks((count) => count + 1)
        onCaptureImported?.(result.corpusItemId)
        notifications.show({
          title: 'Watch import complete',
          message: result.warnings[0] ?? `${title} is ready in the library.`,
          color: result.warnings.length > 0 ? 'yellow' : 'teal',
        })
      } catch (nextError) {
        const message =
          nextError instanceof Error ? nextError.message : 'The recorded chunk could not be imported.'
        setError(message)
        notifications.show({
          title: 'Watch import failed',
          message,
          color: 'red',
        })
      } finally {
        setPendingImports((count) => Math.max(0, count - 1))
      }
    }

    importQueueRef.current = importQueueRef.current.then(performImport, performImport)
  }

  const createRecorder = (sourceStream: MediaStream) => {
    const chunkIndex = chunkIndexRef.current
    const nextChunkStartedAt = new Date().toISOString()
    const recordingStream = buildCaptureStream(sourceStream, sessionCaptureModeRef.current)
    const fallbackMimeType =
      sessionCaptureModeRef.current === 'audio' ? 'audio/webm' : 'video/webm'
    const preferredMimeType = selectCaptureMimeType(sessionCaptureModeRef.current)
    const recorder = preferredMimeType
      ? new MediaRecorder(recordingStream, { mimeType: preferredMimeType })
      : new MediaRecorder(recordingStream)
    const parts: Blob[] = []

    let resolveStop: (chunk: FinalizedChunk) => void = () => undefined
    let resolved = false
    const stopPromise = new Promise<FinalizedChunk>((resolve) => {
      resolveStop = resolve
    })

    const finalize = () => {
      if (resolved) return
      const blob = parts.length > 0 ? new Blob(parts, { type: recorder.mimeType || fallbackMimeType }) : null
      resolved = true
      resolveStop({
        blob,
        mimeType: finalizeChunkMimeType(recorder, fallbackMimeType, blob),
        chunkIndex,
        chunkStartedAt: nextChunkStartedAt,
      })
    }

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        parts.push(event.data)
      }
    }
    recorder.onerror = () => {
      setError('Recording failed while capturing the selected tab or window.')
      setRecordingStatus('error')
      finalize()
    }
    recorder.onstop = finalize

    recorder.start()
    activeRecorderRef.current = {
      recorder,
      chunkIndex,
      chunkStartedAt: nextChunkStartedAt,
      stopPromise,
    }
    setCurrentChunkIndex(chunkIndex)
    setChunkStartedAt(nextChunkStartedAt)
  }

  const finalizeActiveRecorder = async () => {
    const activeRecorder = activeRecorderRef.current
    if (!activeRecorder) {
      return
    }

    activeRecorderRef.current = null
    resetRotationTimer()

    if (activeRecorder.recorder.state !== 'inactive') {
      activeRecorder.recorder.stop()
    }

    const finalizedChunk = await activeRecorder.stopPromise
    queueImport(finalizedChunk)
    chunkIndexRef.current = activeRecorder.chunkIndex + 1
  }

  const scheduleRotation = () => {
    resetRotationTimer()
    rotationTimerRef.current = window.setTimeout(() => {
      void rotateRecorder()
    }, WATCH_CHUNK_MS)
  }

  const rotateRecorder = async () => {
    if (!captureActiveRef.current || isRotatingRef.current || isStoppingRef.current) {
      return
    }

    const sourceStream = sourceStreamRef.current
    if (!sourceStream) {
      return
    }

    isRotatingRef.current = true
    try {
      await finalizeActiveRecorder()
      if (captureActiveRef.current && sourceStream.active) {
        createRecorder(sourceStream)
        scheduleRotation()
      }
    } catch (nextError) {
      const message =
        nextError instanceof Error
          ? nextError.message
          : 'The recorder could not continue after rolling to the next chunk.'
      setError(message)
      notifications.show({
        title: 'Capture stopped',
        message,
        color: 'red',
      })
      await stopCapture()
    } finally {
      isRotatingRef.current = false
    }
  }

  const stopCapture = async (message?: string) => {
    if (isStoppingRef.current) {
      return
    }

    isStoppingRef.current = true
    captureActiveRef.current = false
    setRecordingStatus('stopping')

    try {
      await finalizeActiveRecorder()
    } finally {
      resetRotationTimer()
      sourceStreamRef.current?.getTracks().forEach((track) => track.stop())
      sourceStreamRef.current = null
    }

    await importQueueRef.current
    setChunkStartedAt(undefined)
    setRecordingStatus('idle')
    isStoppingRef.current = false

    if (message) {
      notifications.show({
        title: 'Capture stopped',
        message,
        color: 'blue',
      })
    }
  }

  const resolveTarget = () => {
    try {
      const nextUrl = normalizeWatchUrl(targetUrl)
      setTargetUrl(nextUrl)
      setNormalizedUrl(nextUrl)
      setError(undefined)
      return nextUrl
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Enter an http or https URL.'
      setError(message)
      return null
    }
  }

  const openTargetDirectly = () => {
    const nextUrl = resolveTarget()
    if (!nextUrl) return

    window.open(nextUrl, '_blank', 'noopener,noreferrer')
    setTargetMode('direct_tab')
  }

  const openWatchWindow = () => {
    const nextUrl = resolveTarget()
    if (!nextUrl) return

    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.focus()
      channelRef.current?.postMessage({ type: 'session-state', state: sessionStateRef.current })
      return
    }

    const popup = window.open(
      `/app/watch-window?session=${encodeURIComponent(captureSessionId)}`,
      `watch-${captureSessionId}`,
      'popup=yes,width=1440,height=900',
    )

    if (!popup) {
      setPopupStatus('blocked')
      setError('The watch popup was blocked. Open the target directly and capture that tab instead.')
      return
    }

    popupRef.current = popup
    setTargetMode('iframe')
    setPopupStatus('opening')
    popup.focus()
  }

  const startCapture = async () => {
    if (recordingStatus === 'capturing' || recordingStatus === 'stopping') {
      return
    }

    if (!resolveTarget()) return

    try {
      setError(undefined)
      setImportedChunks(0)
      setPendingImports(0)
      setCurrentChunkIndex(0)
      setChunkStartedAt(undefined)
      setCaptureStartedAt(undefined)
      chunkIndexRef.current = 0
      sessionCaptureModeRef.current = captureMode

      if (!popupRef.current || popupRef.current.closed) {
        openWatchWindow()
      }

      const sourceStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      })

      if (captureMode === 'audio_video' && sourceStream.getAudioTracks().length === 0) {
        notifications.show({
          title: 'No shared audio track',
          message: 'The selected surface is sharing video only. Recording will continue without audio.',
          color: 'yellow',
        })
      }

      const sessionStartedAt = new Date().toISOString()
      captureActiveRef.current = true
      sessionStartedAtRef.current = sessionStartedAt
      sourceStreamRef.current = sourceStream
      setCaptureStartedAt(sessionStartedAt)
      setRecordingStatus('capturing')

      sourceStream.getTracks().forEach((track) => {
        track.addEventListener('ended', () => {
          if (!captureActiveRef.current) {
            return
          }
          void stopCapture('The shared tab or window stopped capturing.')
        })
      })

      createRecorder(sourceStream)
      scheduleRotation()
    } catch (nextError) {
      sourceStreamRef.current?.getTracks().forEach((track) => track.stop())
      sourceStreamRef.current = null
      captureActiveRef.current = false
      setRecordingStatus('error')
      setChunkStartedAt(undefined)

      const message =
        nextError instanceof Error
          ? nextError.message
          : 'Display capture is only available in supported Chromium browsers.'
      setError(message)
      notifications.show({
        title: 'Capture failed',
        message,
        color: 'red',
      })
    }
  }

  const browserCaptureAvailable =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'

  return (
    <Stack gap="lg" style={{ height: '100%' }}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={3}>Watch</Title>
          <Text size="sm" c="dimmed">
            Open a URL in a watch shell, choose that tab in Chromium, and roll imports into the library every five minutes.
          </Text>
        </div>
        <Group gap="xs" wrap="wrap">
          <Badge variant="light" color={semanticCapabilities.enabled ? 'teal' : 'yellow'}>
            {semanticCapabilities.enabled ? 'semantic sync live' : 'local fallback mode'}
          </Badge>
          <Badge variant="outline">{watchPopupLabel(popupStatus)}</Badge>
          <Badge variant="outline">{watchRecordingLabel(recordingStatus)}</Badge>
        </Group>
      </Group>

      <Group align="end" wrap="wrap">
        <TextInput
          label="Target URL"
          placeholder="https://example.com/live"
          value={targetUrl}
          onChange={(event) => setTargetUrl(event.currentTarget.value)}
          style={{ flex: '1 1 440px' }}
          disabled={recordingStatus === 'capturing' || recordingStatus === 'stopping'}
        />
        <Box style={{ minWidth: 260 }}>
          <Text size="sm" fw={600} mb={6}>
            Capture mode
          </Text>
          <SegmentedControl
            fullWidth
            value={captureMode}
            onChange={(value) => setCaptureMode(value as WatchCaptureMode)}
            disabled={recordingStatus === 'capturing' || recordingStatus === 'stopping'}
            data={[
              { label: 'Audio only', value: 'audio' },
              { label: 'Audio + video', value: 'audio_video' },
            ]}
          />
        </Box>
      </Group>

      <Group gap="sm" wrap="wrap">
        <Button onClick={openWatchWindow} variant="filled" color="teal">
          Open watch window
        </Button>
        <Button onClick={openTargetDirectly} variant="light" color="gray">
          Open target directly
        </Button>
        <Button
          onClick={() => void startCapture()}
          disabled={!browserCaptureAvailable || recordingStatus === 'capturing' || recordingStatus === 'stopping'}
        >
          Start capture
        </Button>
        <Button
          onClick={() => void stopCapture('The current watch session was stopped.')}
          color="red"
          variant="light"
          disabled={recordingStatus !== 'capturing' && recordingStatus !== 'error'}
        >
          Stop capture
        </Button>
      </Group>

      <Group gap="md" wrap="wrap">
        <Text size="sm">
          Choose the watch popup or the directly opened target tab in Chromium&apos;s share picker.
        </Text>
        {normalizedUrl ? <Code>{normalizedUrl}</Code> : null}
      </Group>

      <Box
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.2fr) 320px',
          gap: 16,
          minHeight: 0,
          flex: 1,
        }}
      >
        <Stack
          gap="md"
          style={{
            minHeight: 0,
            borderRadius: 8,
            border: '1px solid #d7e6dd',
            background: '#f8fcf9',
            padding: 16,
          }}
        >
          <div>
            <Title order={4}>Session</Title>
            <Text size="sm" c="dimmed">
              The recorder keeps the capture stream alive and rolls a fresh import every five minutes.
            </Text>
          </div>

          <Group gap="xs" wrap="wrap">
            <Badge variant="outline">session {captureSessionId.slice(-8)}</Badge>
            <Badge variant="outline">{targetMode === 'iframe' ? 'iframe shell' : 'direct tab'}</Badge>
            <Badge variant="outline">next chunk {currentChunkIndex + 1}</Badge>
          </Group>

          <Stack gap={6}>
            <Text size="sm" fw={600}>
              Current chunk timer
            </Text>
            <Text size="xl" fw={700}>
              {chunkStartedAt ? formatTimestamp(currentChunkElapsed) : '--:--'}
            </Text>
          </Stack>

          <Group gap="xl" wrap="wrap">
            <div>
              <Text size="sm" c="dimmed">
                Imported chunks
              </Text>
              <Text fw={700}>{importedChunks}</Text>
            </div>
            <div>
              <Text size="sm" c="dimmed">
                Pending imports
              </Text>
              <Text fw={700}>{pendingImports}</Text>
            </div>
            <div>
              <Text size="sm" c="dimmed">
                Capture started
              </Text>
              <Text fw={700}>
                {captureStartedAt
                  ? new Date(captureStartedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '--'}
              </Text>
            </div>
          </Group>

          {error ? (
            <Text size="sm" c="red">
              {error}
            </Text>
          ) : null}

          {!browserCaptureAvailable ? (
            <Text size="sm" c="red">
              Display capture requires a Chromium browser with `getDisplayMedia()` and `MediaRecorder`.
            </Text>
          ) : null}
        </Stack>

        <Stack
          gap="sm"
          style={{
            minHeight: 0,
            borderRadius: 8,
            border: '1px solid #d7e6dd',
            background: '#f8fcf9',
            padding: 16,
          }}
        >
          <div>
            <Title order={4}>Import flow</Title>
            <Text size="sm" c="dimmed">
              Each chunk lands in the library as a normal corpus item, grouped by the same capture session id.
            </Text>
          </div>
          <Stack gap={8}>
            <Text size="sm">1. Open the watch shell or the direct target tab.</Text>
            <Text size="sm">2. Start capture from this page and pick the surface you want.</Text>
            <Text size="sm">3. Let the recorder roll or stop whenever you are done.</Text>
            <Text size="sm">4. Open any imported chunk in the library and use the normal transcript tools.</Text>
          </Stack>
        </Stack>
      </Box>
    </Stack>
  )
}
