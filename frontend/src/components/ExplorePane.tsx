import {
  Badge,
  Box,
  Button,
  Group,
  ScrollArea,
  Slider,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useEffect, useMemo, useState } from 'react'

import { exploreWorkerClient } from '../services/explore'
import type { ApiClient } from '../services/api'
import { loadSemanticWorkingSet } from '../services/retrieval'
import type {
  ClusterTheme,
  ExplorePoint,
  ExploreSession,
  SemanticCapabilities,
} from '../types/models'
import { dispatchOpenLocalTimestamp } from '../utils/events'
import { formatTimestamp } from '../utils/time'
import { SemanticMapCanvas, clusterColor } from './SemanticMapCanvas'

function fallbackThemes(session: { clusters: ExploreSession['clusters'] }): ClusterTheme[] {
  return session.clusters.map((cluster) => ({
    clusterId: cluster.clusterId,
    label: cluster.representatives[0]?.title ?? `Theme ${cluster.clusterId + 1}`,
    explanation:
      cluster.representatives[0]?.text.slice(0, 140) ??
      'Related transcript passages from the same neighborhood.',
    representativeIds: cluster.representativeIds,
  }))
}

interface ExplorePaneProps {
  api: ApiClient
  libraryId: string
  semanticCapabilities: SemanticCapabilities
  activeCorpusItemId?: string
}

export function ExplorePane({
  api,
  libraryId,
  semanticCapabilities,
  activeCorpusItemId,
}: ExplorePaneProps) {
  const [query, setQuery] = useState('')
  const [scopeToActiveItem, setScopeToActiveItem] = useState(false)
  const [clusterCount, setClusterCount] = useState(6)
  const [session, setSession] = useState<ExploreSession | null>(null)
  const [selectedPoint, setSelectedPoint] = useState<ExplorePoint>()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string>()

  const runAnalysis = async (requestedQuery = query, requestedK = clusterCount) => {
    if (!requestedQuery.trim()) {
      setSession(null)
      setSelectedPoint(undefined)
      setError(undefined)
      return
    }

    setIsLoading(true)
    setError(undefined)
    try {
      const workingSet = await loadSemanticWorkingSet(
        api,
        libraryId,
        semanticCapabilities,
        requestedQuery,
        scopeToActiveItem && activeCorpusItemId ? [activeCorpusItemId] : undefined,
        semanticCapabilities.workingSetSize,
      )
      const analysis = await exploreWorkerClient.analyze(workingSet.hits, requestedK)
      const nextSession: ExploreSession = {
        query: requestedQuery,
        retrievalBackend: workingSet.retrievalBackend,
        hits: workingSet.hits,
        points: analysis.points,
        clusters: analysis.clusters,
        themes: [],
      }

      try {
        nextSession.themes = await api.labelThemes(libraryId, analysis.clusters)
      } catch {
        nextSession.themes = fallbackThemes(nextSession)
      }

      setSession(nextSession)
      setSelectedPoint(analysis.points[0])
    } catch (nextError) {
      setSession(null)
      setSelectedPoint(undefined)
      setError(nextError instanceof Error ? nextError.message : 'Explore analysis failed.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!session) return
    void runAnalysis(session.query, clusterCount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusterCount])

  const themesByClusterId = useMemo(
    () => new Map(session?.themes.map((theme) => [theme.clusterId, theme])),
    [session],
  )

  return (
    <Stack gap="md" style={{ height: '100%' }}>
      <Group justify="space-between" align="end">
        <div>
          <Title order={3}>Explore</Title>
          <Text size="sm" c="dimmed">
            Query-local semantic map with browser-side clustering and UMAP layout.
          </Text>
        </div>
        <Badge variant="light" color={semanticCapabilities.enabled ? 'teal' : 'yellow'}>
          {semanticCapabilities.enabled
            ? `${semanticCapabilities.retrievalBackend} retrieval`
            : 'local browser fallback'}
        </Badge>
      </Group>

      <Group align="end" wrap="wrap">
        <TextInput
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Map a topic or question"
          style={{ flex: '1 1 360px' }}
        />
        <Button onClick={() => void runAnalysis()} loading={isLoading}>
          Run map
        </Button>
      </Group>

      <Group justify="space-between" align="center" wrap="wrap">
        <Switch
          checked={scopeToActiveItem}
          disabled={!activeCorpusItemId}
          label="Filter to the active file"
          onChange={(event) => setScopeToActiveItem(event.currentTarget.checked)}
        />
        <Box style={{ minWidth: 220, flex: '0 1 280px' }}>
          <Text size="sm" fw={600} mb={6}>
            Theme count: {clusterCount}
          </Text>
          <Slider
            min={3}
            max={12}
            step={1}
            value={clusterCount}
            onChange={setClusterCount}
            color="teal"
          />
        </Box>
      </Group>

      {error ? (
        <Text size="sm" c="red">
          {error}
        </Text>
      ) : null}

      <Box
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.7fr) 340px',
          gap: 16,
          minHeight: 0,
          flex: 1,
        }}
      >
        <Stack
          gap="sm"
          style={{
            minHeight: 0,
          }}
        >
          <Group justify="space-between" wrap="wrap">
            <Text size="sm" c="dimmed">
              {session
                ? `${session.points.length} points from ${session.retrievalBackend}`
                : `Top ${semanticCapabilities.workingSetSize} transcript chunks around the query`}
            </Text>
            {session ? (
              <Text size="sm" c="dimmed">
                Click a point to inspect it
              </Text>
            ) : null}
          </Group>
          <Box
            style={{
              minHeight: 420,
              flex: 1,
              borderRadius: 8,
              overflow: 'hidden',
              border: '1px solid #d7e6dd',
              background: '#f8fcf9',
            }}
          >
            <SemanticMapCanvas
              points={session?.points ?? []}
              selectedPointId={selectedPoint?.id}
              onSelectPoint={setSelectedPoint}
            />
          </Box>
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
            <Title order={4}>Themes</Title>
            <Text size="sm" c="dimmed">
              Labels are generated from centroid-nearest transcript snippets.
            </Text>
          </div>

          <ScrollArea style={{ flex: 1 }}>
            <Stack gap="sm">
              {(session?.clusters ?? []).map((cluster) => {
                const theme = themesByClusterId.get(cluster.clusterId)
                return (
                  <button
                    key={cluster.clusterId}
                    onClick={() => {
                      const nextPoint = session?.points.find(
                        (point) => point.id === cluster.representativeIds[0],
                      )
                      if (nextPoint) {
                        setSelectedPoint(nextPoint)
                      }
                    }}
                    style={{
                      border: '1px solid #d7e6dd',
                      borderRadius: 8,
                      background: '#ffffff',
                      padding: '12px 14px',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <Stack gap={6}>
                      <Group justify="space-between" wrap="nowrap">
                        <Group gap="xs" wrap="nowrap">
                          <span
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: 999,
                              background: clusterColor(cluster.clusterId),
                              flex: '0 0 auto',
                            }}
                          />
                          <Text fw={700}>{theme?.label ?? `Theme ${cluster.clusterId + 1}`}</Text>
                        </Group>
                        <Badge variant="outline">{cluster.representativeIds.length} reps</Badge>
                      </Group>
                      <Text size="sm" c="dimmed">
                        {theme?.explanation ?? 'Related transcript passages from the same query neighborhood.'}
                      </Text>
                    </Stack>
                  </button>
                )
              })}

              {!session && !isLoading ? (
                <Text size="sm" c="dimmed">
                  Run a query to cluster a semantic neighborhood and lay it out as a map.
                </Text>
              ) : null}
            </Stack>
          </ScrollArea>

          <div>
            <Title order={4}>Selected Point</Title>
            {selectedPoint ? (
              <Stack gap="xs" mt="sm">
                <Group gap="xs">
                  <Badge variant="light">{selectedPoint.title}</Badge>
                  <Badge variant="outline">{formatTimestamp(selectedPoint.startMs)}</Badge>
                </Group>
                <Text size="sm">{selectedPoint.text}</Text>
                <Button
                  variant="light"
                  onClick={() =>
                    dispatchOpenLocalTimestamp({
                      corpusItemId: selectedPoint.corpusItemId,
                      timestampMs: selectedPoint.startMs,
                    })
                  }
                >
                  Open in transcript
                </Button>
              </Stack>
            ) : (
              <Text size="sm" c="dimmed" mt="sm">
                Select a point to open the matching transcript moment.
              </Text>
            )}
          </div>
        </Stack>
      </Box>
    </Stack>
  )
}
