import {
  Badge,
  Button,
  Group,
  Progress,
  ScrollArea,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { useRef } from 'react'

import type { CorpusItem, IngestionJob } from '../types/models'
import { formatDuration, humanBytes } from '../utils/time'

interface LibraryRailProps {
  items: CorpusItem[]
  jobs: IngestionJob[]
  selectedCorpusItemId?: string
  onSelectCorpusItem: (corpusItemId: string) => void
  onImportFiles: (files: FileList) => void
}

export function LibraryRail({
  items,
  jobs,
  selectedCorpusItemId,
  onSelectCorpusItem,
  onImportFiles,
}: LibraryRailProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <Stack gap="md" style={{ height: '100%' }}>
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={3}>Library</Title>
          <Text size="sm" c="dimmed">
            Imported files stay local to this browser origin.
          </Text>
        </div>
        <Button size="xs" color="teal" onClick={() => fileInputRef.current?.click()}>
          Import
        </Button>
      </Group>

      <input
        ref={fileInputRef}
        hidden
        multiple
        accept="audio/*,video/*"
        type="file"
        onChange={(event) => {
          if (event.target.files?.length) {
            onImportFiles(event.target.files)
            event.target.value = ''
          }
        }}
      />

      {jobs.length > 0 ? (
        <Stack gap="xs">
          {jobs.slice(0, 2).map((job) => (
            <Stack gap={4} key={job.id}>
              <Group justify="space-between">
                <Text size="xs" fw={600}>
                  {job.step}
                </Text>
                <Text size="xs" c="dimmed">
                  {Math.round(job.progress)}%
                </Text>
              </Group>
              <Progress value={job.progress} color={job.status === 'error' ? 'red' : 'teal'} />
              {job.error ? (
                <Text size="xs" c="red">
                  {job.error}
                </Text>
              ) : null}
            </Stack>
          ))}
        </Stack>
      ) : null}

      <ScrollArea style={{ flex: 1 }}>
        <Stack gap="xs">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelectCorpusItem(item.id)}
              style={{
                textAlign: 'left',
                border: item.id === selectedCorpusItemId ? '1px solid #1b7d57' : '1px solid #d7e6dd',
                background: item.id === selectedCorpusItemId ? '#edf8f2' : '#ffffff',
                borderRadius: 8,
                padding: '12px 14px',
                cursor: 'pointer',
              }}
            >
              <Stack gap={6}>
                <Group justify="space-between" wrap="nowrap">
                  <Text fw={700} lineClamp={1}>
                    {item.title}
                  </Text>
                  <Badge
                    color={item.status === 'ready' ? 'teal' : item.status === 'error' ? 'red' : 'yellow'}
                    variant="light"
                  >
                    {item.status}
                  </Badge>
                </Group>
                <Group gap="xs">
                  <Badge variant="outline">{item.mediaType || 'unknown'}</Badge>
                  <Badge variant="outline">{humanBytes(item.sizeBytes)}</Badge>
                  <Badge variant="outline">{formatDuration(item.durationMs)}</Badge>
                </Group>
              </Stack>
            </button>
          ))}
          {items.length === 0 ? (
            <Text size="sm" c="dimmed">
              Import an mp4, mp3, or wav file to start building the local corpus.
            </Text>
          ) : null}
        </Stack>
      </ScrollArea>
    </Stack>
  )
}
