import { db } from '../db/schema'
import type {
  CorpusItem,
  EmbeddingRecord,
  IngestionJob,
  PreparedMedia,
  ScreenshotRecord,
  TranscriptApiSegment,
  TranscriptSegment,
} from '../types/models'
import { makeId } from '../utils/id'
import { formatTimestamp } from '../utils/time'
import {
  audioChunkOpfsPath,
  screenshotOpfsPath,
  sourceOpfsPath,
  writeBlob,
} from './opfs'
import type { ApiClient } from './api'

export interface TranscriptChunkManifest {
  chunk_index: number
  file_name: string
  start_ms: number
  overlap_ms: number
  duration_ms?: number
}

type WorkerRequest =
  | {
      id: string
      type: 'prepare-media'
      payload: {
        fileName: string
        mimeType: string
        fileData: ArrayBuffer
      }
    }

type WorkerResponse =
  | {
      id: string
      ok: true
      result: {
        durationMs: number | null
        chunks: Array<{
          id: string
          fileName: string
          mimeType: string
          startMs: number
          endMs: number
          overlapMs: number
          data: ArrayBuffer
        }>
        screenshots: Array<{
          id: string
          timestampMs: number
          fileName: string
          data: ArrayBuffer
        }>
        warnings: string[]
      }
    }
  | {
      id: string
      ok: false
      error: string
    }

class MediaWorkerClient {
  private worker: Worker
  private pending = new Map<
    string,
    {
      resolve: (value: PreparedMedia) => void
      reject: (reason?: unknown) => void
    }
  >()

  constructor() {
    this.worker = new Worker(new URL('../workers/media.worker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const pending = this.pending.get(event.data.id)
      if (!pending) return
      this.pending.delete(event.data.id)
      if (!event.data.ok) {
        pending.reject(new Error(event.data.error))
        return
      }

      const result: PreparedMedia = {
        durationMs: event.data.result.durationMs,
        chunks: event.data.result.chunks.map((chunk) => ({
          id: chunk.id,
          fileName: chunk.fileName,
          mimeType: chunk.mimeType,
          startMs: chunk.startMs,
          endMs: chunk.endMs,
          overlapMs: chunk.overlapMs,
          blob: new Blob([chunk.data], { type: chunk.mimeType }),
        })),
        screenshots: event.data.result.screenshots.map((shot) => ({
          id: shot.id,
          timestampMs: shot.timestampMs,
          blob: new Blob([shot.data], { type: 'image/jpeg' }),
          kind: 'interval',
        })),
        warnings: event.data.result.warnings,
      }
      pending.resolve(result)
    }
  }

  async prepareMedia(file: File): Promise<PreparedMedia> {
    const id = makeId('worker')
    const payload: WorkerRequest = {
      id,
      type: 'prepare-media',
      payload: {
        fileName: file.name,
        mimeType: file.type,
        fileData: await file.arrayBuffer(),
      },
    }

    return new Promise<PreparedMedia>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage(payload, [payload.payload.fileData])
    })
  }
}

const mediaWorkerClient = new MediaWorkerClient()

function normalizeSegments(
  libraryId: string,
  corpusItemId: string,
  segments: TranscriptApiSegment[],
) {
  const sorted = [...segments].sort((left, right) => left.start_ms - right.start_ms)
  const normalized: TranscriptSegment[] = []
  let lastEndMs = 0
  let previousText = ''

  for (const segment of sorted) {
    const text = segment.text.trim()
    if (!text) continue
    if (segment.start_ms < lastEndMs && text === previousText) {
      continue
    }

    const startMs = Math.max(segment.start_ms, lastEndMs > 0 ? lastEndMs - 250 : 0)
    const endMs = Math.max(startMs + 1, segment.end_ms)
    lastEndMs = endMs
    previousText = text

    normalized.push({
      id: segment.id,
      libraryId,
      corpusItemId,
      startMs,
      endMs,
      text,
      speaker: segment.speaker ?? undefined,
      tokenCount: segment.token_count,
      createdAt: new Date().toISOString(),
    })
  }

  return normalized
}

export async function importLocalMedia(
  api: ApiClient,
  libraryId: string,
  file: File,
  onProgress?: (job: Partial<IngestionJob>) => void,
) {
  const corpusItemId = makeId('corp')
  const jobId = makeId('job')
  const sourcePath = sourceOpfsPath(libraryId, corpusItemId, file.name)
  const now = new Date().toISOString()

  const corpusItem: CorpusItem = {
    id: corpusItemId,
    libraryId,
    title: file.name.replace(/\.[^.]+$/, ''),
    mediaType: file.type,
    durationMs: null,
    opfsPath: sourcePath,
    sourceFileName: file.name,
    importedAt: now,
    status: 'processing',
    sizeBytes: file.size,
  }

  const job: IngestionJob = {
    id: jobId,
    libraryId,
    corpusItemId,
    status: 'queued',
    step: 'Saving source media',
    progress: 5,
    createdAt: now,
    updatedAt: now,
  }

  await db.transaction('rw', db.corpusItems, db.ingestionJobs, async () => {
    await db.corpusItems.put(corpusItem)
    await db.ingestionJobs.put(job)
  })
  onProgress?.(job)

  await writeBlob(sourcePath, file)

  const prepared = await mediaWorkerClient.prepareMedia(file)
  const updatedCorpusItem = { ...corpusItem, durationMs: prepared.durationMs }
  await db.corpusItems.put(updatedCorpusItem)

  onProgress?.({
    ...job,
    status: 'running',
    step: 'Persisting audio chunks',
    progress: 20,
    updatedAt: new Date().toISOString(),
  })

  const transcriptionFiles = await Promise.all(
    prepared.chunks.map(async (chunk, index) => {
      const path = audioChunkOpfsPath(libraryId, corpusItemId, chunk.fileName)
      await writeBlob(path, chunk.blob)
      return new File([chunk.blob], chunk.fileName, {
        type: chunk.mimeType,
        lastModified: Date.now() + index,
      })
    }),
  )

  const manifest: TranscriptChunkManifest[] = prepared.chunks.map((chunk, index) => ({
    chunk_index: index,
    file_name: chunk.fileName,
    start_ms: chunk.startMs,
    overlap_ms: chunk.overlapMs,
    duration_ms: chunk.endMs - chunk.startMs,
  }))

  onProgress?.({
    ...job,
    status: 'running',
    step: 'Transcribing chunks',
    progress: 45,
    updatedAt: new Date().toISOString(),
  })

  const transcriptionResponse = await api.transcribeChunks(libraryId, transcriptionFiles, manifest)
  const normalizedSegments = normalizeSegments(
    libraryId,
    corpusItemId,
    transcriptionResponse.segments,
  )

  const screenshotRecords: ScreenshotRecord[] = await Promise.all(
    prepared.screenshots.map(async (shot, index) => {
      const fileName = `shot-${index + 1}.jpg`
      const path = screenshotOpfsPath(libraryId, corpusItemId, fileName)
      await writeBlob(path, shot.blob)
      return {
        id: shot.id,
        libraryId,
        corpusItemId,
        timestampMs: shot.timestampMs,
        opfsPath: path,
        kind: 'interval',
        createdAt: new Date().toISOString(),
      }
    }),
  )

  onProgress?.({
    ...job,
    status: 'running',
    step: 'Generating embeddings',
    progress: 70,
    updatedAt: new Date().toISOString(),
  })

  const embeddingResponse =
    normalizedSegments.length > 0
      ? await api.createEmbeddings(
          libraryId,
          normalizedSegments.map((segment) => segment.text),
        )
      : { model: 'text-embedding-3-small', dimensions: 1536, embeddings: [] }

  const embeddingRecords: EmbeddingRecord[] = embeddingResponse.embeddings.map((vector, index) => {
    const embeddingId = makeId('emb')
    normalizedSegments[index].embeddingId = embeddingId
    return {
      id: embeddingId,
      libraryId,
      ownerType: 'transcript_segment',
      ownerId: normalizedSegments[index].id,
      model: embeddingResponse.model,
      dimensions: embeddingResponse.dimensions,
      vectorBlob: new Float32Array(vector).buffer,
      createdAt: new Date().toISOString(),
    }
  })

  await db.transaction(
    'rw',
    [
      db.corpusItems,
      db.ingestionJobs,
      db.transcriptSegments,
      db.screenshots,
      db.embeddings,
      db.searchDocs,
    ],
    async () => {
      await db.corpusItems.put({ ...updatedCorpusItem, status: 'ready' })
      await db.ingestionJobs.put({
        ...job,
        status: 'complete',
        step: 'Ready',
        progress: 100,
        updatedAt: new Date().toISOString(),
      })
      await db.transcriptSegments.bulkPut(normalizedSegments)
      await db.screenshots.bulkPut(screenshotRecords)
      if (embeddingRecords.length > 0) {
        await db.embeddings.bulkPut(embeddingRecords)
      }
      await db.searchDocs.bulkPut(
        normalizedSegments.map((segment) => ({
          id: segment.id,
          libraryId,
          corpusItemId,
          segmentId: segment.id,
          text: segment.text,
          startMs: segment.startMs,
          endMs: segment.endMs,
        })),
      )
    },
  )

  return {
    corpusItemId,
    warnings: prepared.warnings,
    transcriptPreview: normalizedSegments.slice(0, 3).map((segment) => ({
      ...segment,
      timestampLabel: formatTimestamp(segment.startMs),
    })),
  }
}
