import {
  Badge,
  Group,
  ScrollArea,
  Slider,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { CorpusItem, TranscriptSegment } from '../types/models'
import { formatTimestamp } from '../utils/time'

interface TranscriptPaneProps {
  selectedItem?: CorpusItem
  mediaUrl?: string
  segments: TranscriptSegment[]
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  targetTimestampMs?: number
  onSeek?: (timestampMs: number) => void
}

export function TranscriptPane({
  selectedItem,
  mediaUrl,
  segments,
  searchQuery,
  onSearchQueryChange,
  targetTimestampMs,
  onSeek,
}: TranscriptPaneProps) {
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const [currentMs, setCurrentMs] = useState(0)
  const [durationMs, setDurationMs] = useState<number | null>(selectedItem?.durationMs ?? null)

  useEffect(() => {
    if (!mediaRef.current || targetTimestampMs === undefined) return
    mediaRef.current.currentTime = targetTimestampMs / 1000
  }, [targetTimestampMs])

  const highlightedSegments = useMemo(() => {
    if (!searchQuery.trim()) return segments
    const normalized = searchQuery.trim().toLowerCase()
    return segments.filter((segment) => segment.text.toLowerCase().includes(normalized))
  }, [searchQuery, segments])

  const mediaElement =
    selectedItem && mediaUrl ? (
      selectedItem.mediaType.startsWith('video/') ? (
        <video
          ref={mediaRef}
          controls
          src={mediaUrl}
          style={{ width: '100%', maxHeight: 320, borderRadius: 8, background: '#02150d' }}
          onTimeUpdate={(event) => setCurrentMs(event.currentTarget.currentTime * 1000)}
          onLoadedMetadata={(event) =>
            setDurationMs(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration * 1000 : selectedItem.durationMs)
          }
        />
      ) : (
        <audio
          ref={mediaRef}
          controls
          src={mediaUrl}
          style={{ width: '100%' }}
          onTimeUpdate={(event) => setCurrentMs(event.currentTarget.currentTime * 1000)}
          onLoadedMetadata={(event) =>
            setDurationMs(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration * 1000 : selectedItem.durationMs)
          }
        />
      )
    ) : null

  return (
    <Stack gap="md" style={{ height: '100%' }}>
      <Group justify="space-between" align="end">
        <div>
          <Title order={3}>Transcript</Title>
          <Text size="sm" c="dimmed">
            Search locally, then hand only the retrieved evidence to the model.
          </Text>
        </div>
        {selectedItem ? <Badge variant="light">{selectedItem.sourceFileName}</Badge> : null}
      </Group>

      {mediaElement ?? (
        <Stack
          align="center"
          justify="center"
          style={{
            minHeight: 220,
            background: '#dae7df',
            borderRadius: 8,
            border: '1px solid #c7dad0',
          }}
        >
          <Text fw={600}>Select an imported file</Text>
          <Text size="sm" c="dimmed">
            The media player, transcript, and evidence viewer stay bound to the active corpus item.
          </Text>
        </Stack>
      )}

      <Stack gap={6}>
        <Group justify="space-between">
          <Text size="sm" fw={600}>
            {formatTimestamp(currentMs)}
          </Text>
          <Text size="sm" c="dimmed">
            {formatTimestamp(durationMs ?? 0)}
          </Text>
        </Group>
        <Slider
          value={durationMs ? Math.min(currentMs, durationMs) : 0}
          max={durationMs ?? 1}
          step={250}
          color="teal"
          onChange={(value) => {
            setCurrentMs(value)
            if (mediaRef.current) {
              mediaRef.current.currentTime = value / 1000
            }
            onSeek?.(value)
          }}
        />
      </Stack>

      <TextInput
        value={searchQuery}
        onChange={(event) => onSearchQueryChange(event.currentTarget.value)}
        placeholder="Search transcript locally"
      />

      <ScrollArea style={{ flex: 1 }}>
        <Stack gap="xs">
          {highlightedSegments.map((segment) => (
            <button
              key={segment.id}
              onClick={() => {
                if (mediaRef.current) {
                  mediaRef.current.currentTime = segment.startMs / 1000
                }
                onSeek?.(segment.startMs)
              }}
              style={{
                borderRadius: 8,
                border: '1px solid #d7e6dd',
                padding: '12px 14px',
                background: '#ffffff',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <Group justify="space-between" align="start" wrap="nowrap">
                <Stack gap={4} style={{ flex: 1 }}>
                  <Group gap="xs">
                    <Badge variant="outline">{formatTimestamp(segment.startMs)}</Badge>
                    {segment.speaker ? <Badge variant="outline">{segment.speaker}</Badge> : null}
                  </Group>
                  <Text size="sm">{segment.text}</Text>
                </Stack>
              </Group>
            </button>
          ))}
          {highlightedSegments.length === 0 ? (
            <Text size="sm" c="dimmed">
              Transcript segments will appear here after transcription completes.
            </Text>
          ) : null}
        </Stack>
      </ScrollArea>
    </Stack>
  )
}
