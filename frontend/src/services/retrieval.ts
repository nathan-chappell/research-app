import { db } from '../db/schema'
import type {
  EmbeddingRecord,
  EvidenceBundle,
  EvidenceRef,
  EvidenceScreenshot,
  EvidenceSegment,
  SearchDocRecord,
  SemanticCapabilities,
  SemanticSearchHit,
  TranscriptSegment,
} from '../types/models'
import { formatTimestamp } from '../utils/time'
import type { ApiClient } from './api'

type WorkerRequest =
  | {
      id: string
      type: 'build-index'
      payload: {
        libraryId: string
        documents: Array<SearchDocRecord & { vector?: number[] }>
      }
    }
  | {
      id: string
      type: 'search'
      payload: {
        libraryId: string
        query: string
        topK: number
        corpusItemIds?: string[]
        queryVector?: number[]
      }
    }

type WorkerResponse =
  | {
      id: string
      ok: true
      result: {
        hits: Array<SearchDocRecord & { score: number }>
      }
    }
  | {
      id: string
      ok: false
      error: string
    }

class RetrievalWorkerClient {
  private worker: Worker
  private pending = new Map<string, { resolve: (value: WorkerResponse) => void; reject: (reason?: unknown) => void }>()

  constructor() {
    this.worker = new Worker(new URL('../workers/retrieval.worker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const pending = this.pending.get(event.data.id)
      if (!pending) return
      this.pending.delete(event.data.id)
      pending.resolve(event.data)
    }
  }

  private send(message: WorkerRequest) {
    return new Promise<WorkerResponse>((resolve, reject) => {
      this.pending.set(message.id, { resolve, reject })
      this.worker.postMessage(message)
    })
  }

  async buildIndex(
    libraryId: string,
    documents: Array<SearchDocRecord & { vector?: number[] }>,
  ) {
    const response = await this.send({
      id: `build_${Date.now()}`,
      type: 'build-index',
      payload: { libraryId, documents },
    })
    if (!response.ok) throw new Error(response.error)
  }

  async search(
    libraryId: string,
    query: string,
    topK: number,
    corpusItemIds?: string[],
    queryVector?: number[],
  ) {
    const response = await this.send({
      id: `search_${Date.now()}`,
      type: 'search',
      payload: { libraryId, query, topK, corpusItemIds, queryVector },
    })
    if (!response.ok) throw new Error(response.error)
    return response.result.hits
  }
}

const retrievalWorkerClient = new RetrievalWorkerClient()

function decodeVector(record: EmbeddingRecord) {
  return Array.from(new Float32Array(record.vectorBlob))
}

async function buildIndex(libraryId: string) {
  const [searchDocs, embeddings] = await Promise.all([
    db.searchDocs.where('libraryId').equals(libraryId).toArray(),
    db.embeddings.where('libraryId').equals(libraryId).toArray(),
  ])

  const vectorsByOwnerId = new Map(embeddings.map((embedding) => [embedding.ownerId, decodeVector(embedding)]))
  await retrievalWorkerClient.buildIndex(
    libraryId,
    searchDocs.map((doc) => ({
      ...doc,
      vector: vectorsByOwnerId.get(doc.segmentId),
    })),
  )
}

function uniqueById<T extends { id: string }>(items: T[]) {
  return Array.from(new Map(items.map((item) => [item.id, item])).values())
}

function isDefined<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null
}

async function searchLocalHits(
  api: ApiClient,
  libraryId: string,
  query: string,
  corpusItemIds: string[] | undefined,
  topK: number,
): Promise<SemanticSearchHit[]> {
  await buildIndex(libraryId)
  let queryVector: number[] | undefined

  if (query.trim()) {
    try {
      const embeddingResponse = await api.createEmbeddings(libraryId, [query])
      queryVector = embeddingResponse.embeddings[0]
    } catch {
      queryVector = undefined
    }
  }

  const hits = await retrievalWorkerClient.search(
    libraryId,
    query,
    topK,
    corpusItemIds,
    queryVector,
  )
  const hitSegmentIds = hits.map((hit) => hit.segmentId)
  const [embeddingRecords, corpusItems, transcriptSegments] = await Promise.all([
    db.embeddings.where('libraryId').equals(libraryId).filter((record) => hitSegmentIds.includes(record.ownerId)).toArray(),
    db.corpusItems.bulkGet(uniqueById(hits.map((hit) => ({ id: hit.corpusItemId }))).map((item) => item.id)),
    db.transcriptSegments.bulkGet(hitSegmentIds),
  ])
  const embeddingsBySegmentId = new Map(
    embeddingRecords.map((record) => [record.ownerId, decodeVector(record)]),
  )
  const corpusItemsById = new Map(corpusItems.filter(isDefined).map((item) => [item.id, item]))
  const transcriptSegmentsById = new Map(
    transcriptSegments.filter(isDefined).map((segment) => [segment.id, segment]),
  )

  return hits.map((hit) => {
    const corpusItem = corpusItemsById.get(hit.corpusItemId)
    const transcriptSegment = transcriptSegmentsById.get(hit.segmentId)
    return {
      id: hit.segmentId,
      corpusItemId: hit.corpusItemId,
      title: corpusItem?.title ?? hit.corpusItemId,
      sourceFileName: corpusItem?.sourceFileName ?? '',
      text: hit.text,
      startMs: hit.startMs,
      endMs: hit.endMs,
      speaker: transcriptSegment?.speaker,
      tokenCount: transcriptSegment?.tokenCount ?? 0,
      score: hit.score,
      embedding: embeddingsBySegmentId.get(hit.segmentId) ?? [],
    }
  })
}

async function collectScreenshots(
  libraryId: string,
  evidenceSegments: EvidenceSegment[],
) {
  return uniqueById(
    (
      await Promise.all(
        evidenceSegments.slice(0, 3).map((segment) =>
          db.screenshots
            .where('[libraryId+corpusItemId+timestampMs]')
            .between(
              [libraryId, segment.corpusItemId, Math.max(0, segment.timestampMs - 15000)],
              [libraryId, segment.corpusItemId, segment.timestampMs + 15000],
            )
            .toArray(),
        ),
      )
    ).flat(),
  )
    .slice(0, 3)
    .map<EvidenceScreenshot>((shot) => ({
      id: shot.id,
      corpusItemId: shot.corpusItemId,
      timestampMs: shot.timestampMs,
      timestampLabel: formatTimestamp(shot.timestampMs),
      opfsPath: shot.opfsPath,
    }))
}

async function buildEvidenceBundle(
  libraryId: string,
  query: string,
  hits: SemanticSearchHit[],
  retrievalBackend: string,
  topK: number,
): Promise<EvidenceBundle> {
  const evidenceSegments: EvidenceSegment[] = hits.slice(0, topK).map((hit) => ({
    id: hit.id,
    corpusItemId: hit.corpusItemId,
    timestampMs: hit.startMs,
    timestampLabel: formatTimestamp(hit.startMs),
    text: hit.text,
    score: hit.score,
    speaker: hit.speaker,
  }))

  const screenshots = await collectScreenshots(libraryId, evidenceSegments)

  const refs: EvidenceRef[] = [
    ...evidenceSegments.map((segment) => ({
      id: segment.id,
      title: segment.timestampLabel,
      kind: 'transcript' as const,
      corpusItemId: segment.corpusItemId,
      timestampMs: segment.timestampMs,
      excerpt: segment.text,
    })),
    ...screenshots.map((shot) => ({
      id: shot.id,
      title: shot.timestampLabel,
      kind: 'screenshot' as const,
      corpusItemId: shot.corpusItemId,
      timestampMs: shot.timestampMs,
      excerpt: `Screenshot at ${shot.timestampLabel}`,
      screenshotPath: shot.opfsPath,
    })),
  ]

  return {
    query,
    retrievalBackend,
    segments: evidenceSegments,
    screenshots,
    refs,
  }
}

async function retrieveLocalOnlyEvidence(
  api: ApiClient,
  libraryId: string,
  query: string,
  corpusItemIds: string[] | undefined,
  topK: number,
): Promise<EvidenceBundle> {
  const hits = await searchLocalHits(api, libraryId, query, corpusItemIds, Math.max(topK, 24))
  if (hits.length > 0) {
    return buildEvidenceBundle(libraryId, query, hits, 'local-browser', topK)
  }

  const hitSegmentIds = hits.map((hit) => hit.id)
  const hitSegments = await db.transcriptSegments.bulkGet(hitSegmentIds)
  const resolvedSegments = hitSegments.filter(Boolean) as TranscriptSegment[]
  const neighborMap = new Map<string, TranscriptSegment>()

  for (const segment of resolvedSegments) {
    const neighbors = await db.transcriptSegments
      .where('[libraryId+corpusItemId+startMs]')
      .between(
        [libraryId, segment.corpusItemId, Math.max(0, segment.startMs - 30000)],
        [libraryId, segment.corpusItemId, segment.endMs + 30000],
      )
      .toArray()
    neighbors.forEach((neighbor) => neighborMap.set(neighbor.id, neighbor))
  }

  const orderedSegments = uniqueById(
    Array.from(neighborMap.values()).sort((left, right) => left.startMs - right.startMs),
  )

  return {
    query,
    retrievalBackend: 'local-browser',
    segments: orderedSegments.slice(0, topK).map((segment) => ({
      id: segment.id,
      corpusItemId: segment.corpusItemId,
      timestampMs: segment.startMs,
      timestampLabel: formatTimestamp(segment.startMs),
      text: segment.text,
      score: 0,
      speaker: segment.speaker,
    })),
    screenshots: [],
    refs: [],
  }
}

export async function loadSemanticWorkingSet(
  api: ApiClient,
  libraryId: string,
  semanticCapabilities: SemanticCapabilities,
  query: string,
  corpusItemIds: string[] | undefined,
  topK: number,
): Promise<{ retrievalBackend: string; hits: SemanticSearchHit[] }> {
  if (!query.trim()) {
    return { retrievalBackend: semanticCapabilities.retrievalBackend, hits: [] }
  }

  if (semanticCapabilities.enabled) {
    try {
      const response = await api.searchSemantic(libraryId, query, topK, { corpusItemIds })
      return {
        retrievalBackend: response.retrievalBackend,
        hits: response.hits,
      }
    } catch {
      // Fall through to the local browser search cache.
    }
  }

  return {
    retrievalBackend: 'local-browser',
    hits: await searchLocalHits(api, libraryId, query, corpusItemIds, topK),
  }
}

export async function retrieveEvidence(
  api: ApiClient,
  libraryId: string,
  semanticCapabilities: SemanticCapabilities,
  query: string,
  corpusItemIds: string[] | undefined,
  topK = 6,
): Promise<EvidenceBundle> {
  const workingSet = await loadSemanticWorkingSet(
    api,
    libraryId,
    semanticCapabilities,
    query,
    corpusItemIds,
    Math.max(topK, 24),
  )
  if (workingSet.hits.length > 0) {
    return buildEvidenceBundle(libraryId, query, workingSet.hits, workingSet.retrievalBackend, topK)
  }

  return retrieveLocalOnlyEvidence(api, libraryId, query, corpusItemIds, topK)
}
