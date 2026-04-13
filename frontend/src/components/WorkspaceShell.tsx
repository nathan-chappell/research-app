import Dexie from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { AppShell, Box, Group, Loader, SegmentedControl, Stack, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useMemo, useState } from 'react'

import { db } from '../db/schema'
import { useWorkspaceBootstrap } from '../hooks/useWorkspaceBootstrap'
import { importLocalMedia } from '../services/media'
import { readObjectUrl } from '../services/opfs'
import type { CorpusItem, EvidenceBundle, IngestionJob } from '../types/models'
import { OPEN_LOCAL_TIMESTAMP_EVENT } from '../utils/events'
import { ChatPane } from './ChatPane'
import { EvidencePane } from './EvidencePane'
import { ExplorePane } from './ExplorePane'
import { LibraryRail } from './LibraryRail'
import { TranscriptPane } from './TranscriptPane'

function sortByNewest<T extends { importedAt?: string; updatedAt?: string }>(items: T[]) {
  return [...items].sort((left, right) => {
    const leftValue = left.importedAt ?? left.updatedAt ?? ''
    const rightValue = right.importedAt ?? right.updatedAt ?? ''
    return rightValue.localeCompare(leftValue)
  })
}

export function WorkspaceShell() {
  const { api, auth, libraryId, isReady, semanticCapabilities } = useWorkspaceBootstrap()
  const [selectedCorpusItemId, setSelectedCorpusItemId] = useState<string>()
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [mediaUrl, setMediaUrl] = useState<string>()
  const [targetTimestampMs, setTargetTimestampMs] = useState<number>()
  const [evidence, setEvidence] = useState<EvidenceBundle | null>(null)
  const [viewMode, setViewMode] = useState<'workspace' | 'explore'>('workspace')

  const corpusItems = useLiveQuery(
    async () =>
      libraryId
        ? sortByNewest(await db.corpusItems.where('libraryId').equals(libraryId).toArray())
        : [],
    [libraryId],
    [],
  )

  const ingestionJobs = useLiveQuery(
    async () =>
      libraryId
        ? sortByNewest(await db.ingestionJobs.where('libraryId').equals(libraryId).toArray())
        : [],
    [libraryId],
    [],
  )

  useEffect(() => {
    if (!selectedCorpusItemId && corpusItems.length > 0) {
      setSelectedCorpusItemId(corpusItems[0].id)
    }
  }, [corpusItems, selectedCorpusItemId])

  const selectedItem = useMemo<CorpusItem | undefined>(
    () => corpusItems.find((item) => item.id === selectedCorpusItemId),
    [corpusItems, selectedCorpusItemId],
  )

  const segments = useLiveQuery(
    async () => {
      if (!libraryId || !selectedCorpusItemId) return []
      return db.transcriptSegments
        .where('[libraryId+corpusItemId+startMs]')
        .between(
          [libraryId, selectedCorpusItemId, Dexie.minKey],
          [libraryId, selectedCorpusItemId, Dexie.maxKey],
        )
        .toArray()
    },
    [libraryId, selectedCorpusItemId],
    [],
  )

  useEffect(() => {
    let cancelled = false
    let nextUrl: string | undefined

    void (async () => {
      if (!selectedItem) {
        setMediaUrl(undefined)
        return
      }
      try {
        nextUrl = await readObjectUrl(selectedItem.opfsPath)
        if (!cancelled) {
          setMediaUrl(nextUrl)
        }
      } catch {
        if (!cancelled) {
          setMediaUrl(undefined)
        }
      }
    })()

    return () => {
      cancelled = true
      if (nextUrl) URL.revokeObjectURL(nextUrl)
    }
  }, [selectedItem])

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ corpusItemId: string; timestampMs: number }>).detail
      setSelectedCorpusItemId(detail.corpusItemId)
      setTargetTimestampMs(detail.timestampMs)
    }
    window.addEventListener(OPEN_LOCAL_TIMESTAMP_EVENT, listener)
    return () => window.removeEventListener(OPEN_LOCAL_TIMESTAMP_EVENT, listener)
  }, [])

  useEffect(() => {
    if (!libraryId || !selectedCorpusItemId) {
      setEvidence(null)
      return
    }

    if (!searchQuery.trim()) {
      setEvidence(null)
      return
    }

    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const bundle = await import('../services/retrieval').then(({ retrieveEvidence }) =>
            retrieveEvidence(api, libraryId, semanticCapabilities, searchQuery, [selectedCorpusItemId], 6),
          )
          setEvidence(bundle)
        } catch {
          // Keep the workspace responsive even when retrieval is not available yet.
        }
      })()
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [api, libraryId, searchQuery, selectedCorpusItemId, semanticCapabilities])

  const handleImportFiles = async (fileList: FileList) => {
    if (!libraryId) return

    for (const file of Array.from(fileList)) {
      try {
        const result = await importLocalMedia(api, libraryId, semanticCapabilities, file, async (job) => {
          if (job.id) {
            await db.ingestionJobs.put(job as IngestionJob)
          }
        })
        setSelectedCorpusItemId(result.corpusItemId)
        notifications.show({
          title: 'Import complete',
          message: result.warnings[0] ?? `${file.name} is ready for local search and chat.`,
          color: result.warnings.length > 0 ? 'yellow' : 'teal',
        })
      } catch (error) {
        notifications.show({
          title: 'Import failed',
          message: error instanceof Error ? error.message : 'The media file could not be ingested.',
          color: 'red',
        })
      }
    }
  }

  if (!auth.isAuthenticated) {
    return null
  }

  if (!isReady || !libraryId) {
    return (
      <Stack align="center" justify="center" style={{ minHeight: '100vh' }}>
        <Loader color="teal" />
        <Text c="dimmed">Preparing the local library and browser storage.</Text>
      </Stack>
    )
  }

  return (
    <AppShell
      header={{ height: 68 }}
      padding="md"
      styles={{
        main: {
          background: '#eef4f1',
          minHeight: '100vh',
        },
      }}
    >
      <AppShell.Header>
        <Group justify="space-between" px="lg" py="md" style={{ height: '100%' }}>
          <Group gap="lg">
            <div>
              <Title order={2}>Research App</Title>
              <Text size="sm" c="dimmed">
                Media playback, semantic retrieval, browser clustering
              </Text>
            </div>
            <SegmentedControl
              value={viewMode}
              onChange={(value) => setViewMode(value as 'workspace' | 'explore')}
              data={[
                { label: 'Workspace', value: 'workspace' },
                { label: 'Explore', value: 'explore' },
              ]}
            />
          </Group>
          <Group gap="md">
            <Text size="sm" c="dimmed">
              {semanticCapabilities.enabled ? 'Hosted semantic retrieval ready' : 'Local fallback mode'}
            </Text>
            <Text size="sm" c="dimmed">
              {auth.user?.name}
            </Text>
          </Group>
        </Group>
      </AppShell.Header>

      {viewMode === 'workspace' ? (
        <Box
          style={{
            display: 'grid',
            gridTemplateColumns: '280px minmax(420px, 1fr) 320px 420px',
            gap: 16,
            minHeight: 'calc(100vh - 100px)',
          }}
        >
          <Box
            style={{
              borderRadius: 8,
              border: '1px solid #d7e6dd',
              background: '#f8fcf9',
              padding: 16,
              minHeight: 0,
            }}
          >
            <LibraryRail
              items={corpusItems}
              jobs={ingestionJobs}
              selectedCorpusItemId={selectedCorpusItemId}
              onSelectCorpusItem={(corpusItemId) => {
                setSelectedCorpusItemId(corpusItemId)
                setTargetTimestampMs(undefined)
              }}
              onImportFiles={handleImportFiles}
            />
          </Box>

          <Box
            style={{
              borderRadius: 8,
              border: '1px solid #d7e6dd',
              background: '#f8fcf9',
              padding: 16,
              minHeight: 0,
            }}
          >
            <TranscriptPane
              selectedItem={selectedItem}
              mediaUrl={mediaUrl}
              segments={segments}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              targetTimestampMs={targetTimestampMs}
              onSeek={setTargetTimestampMs}
            />
          </Box>

          <Box
            style={{
              borderRadius: 8,
              border: '1px solid #d7e6dd',
              background: '#f8fcf9',
              padding: 16,
              minHeight: 0,
            }}
          >
            <EvidencePane evidence={evidence} />
          </Box>

          <Box style={{ minHeight: 0 }}>
            <ChatPane
              api={api}
              libraryId={libraryId}
              semanticCapabilities={semanticCapabilities}
              activeCorpusItemId={selectedCorpusItemId}
              activeThreadId={activeThreadId}
              onThreadChange={setActiveThreadId}
              onEvidence={setEvidence}
            />
          </Box>
        </Box>
      ) : (
        <Box
          style={{
            minHeight: 'calc(100vh - 100px)',
            borderRadius: 8,
            border: '1px solid #d7e6dd',
            background: '#f8fcf9',
            padding: 16,
          }}
        >
          <ExplorePane
            api={api}
            libraryId={libraryId}
            semanticCapabilities={semanticCapabilities}
            activeCorpusItemId={selectedCorpusItemId}
          />
        </Box>
      )}
    </AppShell>
  )
}
