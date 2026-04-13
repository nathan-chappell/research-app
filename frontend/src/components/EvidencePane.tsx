import { Group, Image, ScrollArea, Stack, Text, Title } from '@mantine/core'
import { useEffect, useState } from 'react'

import type { EvidenceBundle } from '../types/models'
import { dispatchOpenLocalTimestamp } from '../utils/events'
import { readObjectUrl } from '../services/opfs'

interface EvidencePaneProps {
  evidence: EvidenceBundle | null
}

export function EvidencePane({ evidence }: EvidencePaneProps) {
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    const urls: string[] = []

    void (async () => {
      if (!evidence?.screenshots.length) {
        setImageUrls({})
        return
      }
      const entries = await Promise.all(
        evidence.screenshots.map(async (shot) => {
          const url = await readObjectUrl(shot.opfsPath)
          urls.push(url)
          return [shot.id, url] as const
        }),
      )
      if (!cancelled) {
        setImageUrls(Object.fromEntries(entries))
      }
    })()

    return () => {
      cancelled = true
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [evidence])

  return (
    <Stack gap="md" style={{ height: '100%' }}>
      <div>
        <Title order={3}>Evidence</Title>
        <Text size="sm" c="dimmed">
          Retrieved locally from transcript text, embeddings, and nearby screenshots.
        </Text>
      </div>

      <ScrollArea style={{ flex: 1 }}>
        <Stack gap="md">
          {evidence?.segments.map((segment) => (
            <button
              key={segment.id}
              onClick={() =>
                dispatchOpenLocalTimestamp({
                  corpusItemId: segment.corpusItemId,
                  timestampMs: segment.timestampMs,
                })
              }
              style={{
                border: '1px solid #d7e6dd',
                background: '#ffffff',
                borderRadius: 8,
                padding: '12px 14px',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <Stack gap={6}>
                <Group justify="space-between">
                  <Text fw={700}>{segment.timestampLabel}</Text>
                  <Text size="xs" c="dimmed">
                    score {segment.score.toFixed(2)}
                  </Text>
                </Group>
                <Text size="sm">{segment.text}</Text>
              </Stack>
            </button>
          ))}

          {evidence?.screenshots.map((shot) => (
            <button
              key={shot.id}
              onClick={() =>
                dispatchOpenLocalTimestamp({
                  corpusItemId: shot.corpusItemId,
                  timestampMs: shot.timestampMs,
                })
              }
              style={{
                border: '1px solid #d7e6dd',
                background: '#ffffff',
                borderRadius: 8,
                padding: '10px',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <Stack gap="xs">
                <Text fw={700}>{shot.timestampLabel}</Text>
                {imageUrls[shot.id] ? (
                  <Image radius="sm" src={imageUrls[shot.id]} alt={`Screenshot at ${shot.timestampLabel}`} />
                ) : (
                  <Text size="sm" c="dimmed">
                    Loading screenshot...
                  </Text>
                )}
              </Stack>
            </button>
          ))}

          {!evidence ? (
            <Text size="sm" c="dimmed">
              Run a transcript search or ask the chat pane a question to populate evidence here.
            </Text>
          ) : null}
        </Stack>
      </ScrollArea>
    </Stack>
  )
}
