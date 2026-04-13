import type { TranscriptChunkManifest } from './media'
import type { EvidenceBundle, TranscriptApiSegment } from '../types/models'
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
