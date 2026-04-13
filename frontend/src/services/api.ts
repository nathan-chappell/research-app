import type { TranscriptChunkManifest } from './media'
import type {
  ClusterTheme,
  EvidenceBundle,
  SemanticCapabilities,
  SemanticSearchFilters,
  SemanticSearchHit,
  ThemeRepresentative,
  TranscriptApiSegment,
} from '../types/models'
import { appConfig } from '../config'

async function request<T>(
  path: string,
  options: RequestInit,
  getAccessToken: () => Promise<string | null>,
  libraryId?: string,
): Promise<T> {
  const token = await getAccessToken()
  const headers = new Headers(options.headers ?? {})
  headers.set('Accept', 'application/json')
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (libraryId) {
    headers.set('X-Library-Id', libraryId)
  }

  const response = await fetch(`${appConfig.apiBaseUrl}${path}`, {
    ...options,
    headers,
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  return (await response.json()) as T
}

export function createApiClient(getAccessToken: () => Promise<string | null>) {
  return {
    async getSemanticCapabilities(): Promise<SemanticCapabilities> {
      const response = await request<{
        enabled: boolean
        retrieval_backend: string
        fallback_backend?: string | null
        embedding_model: string
        embedding_dimensions: number
        working_set_size: number
      }>(
        '/semantic/capabilities',
        { method: 'GET' },
        getAccessToken,
      )
      return {
        enabled: response.enabled,
        retrievalBackend: response.retrieval_backend,
        fallbackBackend: response.fallback_backend,
        embeddingModel: response.embedding_model,
        embeddingDimensions: response.embedding_dimensions,
        workingSetSize: response.working_set_size,
      }
    },

    async registerLibrary(
      libraryId: string,
      name: string,
    ): Promise<{ id: string; name: string; created_at?: string }> {
      return request<{ id: string; name: string; created_at?: string }>(
        '/libraries/register',
        {
          method: 'POST',
          body: JSON.stringify({ library_id: libraryId, name }),
        },
        getAccessToken,
      )
    },

    async transcribeChunks(
      libraryId: string,
      files: File[],
      manifest: TranscriptChunkManifest[],
    ) {
      const formData = new FormData()
      files.forEach((file) => {
        formData.append('files', file, file.name)
      })
      formData.append('chunk_manifest_json', JSON.stringify(manifest))
      return request<{ segments: TranscriptApiSegment[] }>(
        '/ingestion/transcriptions',
        {
          method: 'POST',
          body: formData,
        },
        getAccessToken,
        libraryId,
      )
    },

    async createEmbeddings(libraryId: string, texts: string[]) {
      return request<{ model: string; dimensions: number; embeddings: number[][] }>(
        '/embeddings',
        {
          method: 'POST',
          body: JSON.stringify({ library_id: libraryId, texts }),
        },
        getAccessToken,
        libraryId,
      )
    },

    async syncSemanticTranscript(
      libraryId: string,
      payload: {
        corpusItem: {
          id: string
          title: string
          sourceFileName: string
          mediaType: string
          durationMs: number | null
          importedAt: string
          metadata?: Record<string, unknown>
        }
        chunks: Array<{
          id: string
          startMs: number
          endMs: number
          text: string
          speaker?: string | null
          tokenCount: number
          metadata?: Record<string, unknown>
        }>
      },
    ) {
      return request<{
        corpus_item_id: string
        chunk_ids: string[]
        embedded_chunk_ids: string[]
        chunk_count: number
        embedding_model: string
        embedding_dimensions: number
        last_synced_at: string
      }>(
        '/semantic/sync',
        {
          method: 'POST',
          body: JSON.stringify({
            library_id: libraryId,
            corpus_item: {
              id: payload.corpusItem.id,
              title: payload.corpusItem.title,
              source_file_name: payload.corpusItem.sourceFileName,
              media_type: payload.corpusItem.mediaType,
              duration_ms: payload.corpusItem.durationMs,
              imported_at: payload.corpusItem.importedAt,
              metadata: payload.corpusItem.metadata ?? {},
            },
            chunks: payload.chunks.map((chunk) => ({
              id: chunk.id,
              start_ms: chunk.startMs,
              end_ms: chunk.endMs,
              text: chunk.text,
              speaker: chunk.speaker,
              token_count: chunk.tokenCount,
              metadata: chunk.metadata ?? {},
            })),
          }),
        },
        getAccessToken,
        libraryId,
      )
    },

    async searchSemantic(
      libraryId: string,
      query: string,
      topK: number,
      filters?: SemanticSearchFilters,
    ): Promise<{
      query: string
      retrievalBackend: string
      hosted: boolean
      hits: SemanticSearchHit[]
    }> {
      const response = await request<{
        query: string
        retrieval_backend: string
        hosted: boolean
        hits: Array<{
          id: string
          corpus_item_id: string
          title: string
          source_file_name: string
          text: string
          start_ms: number
          end_ms: number
          speaker?: string | null
          token_count: number
          score: number
          embedding: number[]
        }>
      }>(
        '/semantic/search',
        {
          method: 'POST',
          body: JSON.stringify({
            library_id: libraryId,
            query,
            top_k: topK,
            corpus_item_ids: filters?.corpusItemIds ?? [],
          }),
        },
        getAccessToken,
        libraryId,
      )

      return {
        query: response.query,
        retrievalBackend: response.retrieval_backend,
        hosted: response.hosted,
        hits: response.hits.map((hit) => ({
          id: hit.id,
          corpusItemId: hit.corpus_item_id,
          title: hit.title,
          sourceFileName: hit.source_file_name,
          text: hit.text,
          startMs: hit.start_ms,
          endMs: hit.end_ms,
          speaker: hit.speaker,
          tokenCount: hit.token_count,
          score: hit.score,
          embedding: hit.embedding,
        })),
      }
    },

    async labelThemes(
      libraryId: string,
      clusters: Array<{ clusterId: number; representatives: ThemeRepresentative[] }>,
    ): Promise<ClusterTheme[]> {
      const response = await request<{
        labels: Array<{
          cluster_id: number
          label: string
          explanation: string
          representative_ids: string[]
        }>
      }>(
        '/semantic/themes/labels',
        {
          method: 'POST',
          body: JSON.stringify({
            library_id: libraryId,
            clusters: clusters.map((cluster) => ({
              cluster_id: cluster.clusterId,
              representatives: cluster.representatives.map((representative) => ({
                id: representative.id,
                text: representative.text,
                title: representative.title,
                timestamp_ms: representative.timestampMs,
              })),
            })),
          }),
        },
        getAccessToken,
        libraryId,
      )

      return response.labels.map((label) => ({
        clusterId: label.cluster_id,
        label: label.label,
        explanation: label.explanation,
        representativeIds: label.representative_ids,
      }))
    },

    async listThreads(libraryId: string) {
      return request<Array<Record<string, unknown>>>(
        '/threads',
        { method: 'GET' },
        getAccessToken,
        libraryId,
      )
    },

    async getThread(libraryId: string, threadId: string) {
      return request<Record<string, unknown>>(
        `/threads/${threadId}`,
        { method: 'GET' },
        getAccessToken,
        libraryId,
      )
    },

    createChatKitFetch(libraryId: string, activeCorpusItemId?: string) {
      return async (input: RequestInfo | URL, init?: RequestInit) => {
        const token = await getAccessToken()
        const headers = new Headers(init?.headers ?? {})
        if (token) {
          headers.set('Authorization', `Bearer ${token}`)
        }
        headers.set('X-Library-Id', libraryId)
        if (activeCorpusItemId) {
          headers.set('X-Active-Corpus-Item-Id', activeCorpusItemId)
        }
        return fetch(input, { ...init, headers })
      }
    },
  }
}

export type ApiClient = ReturnType<typeof createApiClient>

export interface RetrieveLocalEvidenceInput {
  query: string
  libraryId: string
  corpusItemIds?: string[]
  topK?: number
}

export type RetrieveLocalEvidenceHandler = (
  input: RetrieveLocalEvidenceInput,
) => Promise<EvidenceBundle>
