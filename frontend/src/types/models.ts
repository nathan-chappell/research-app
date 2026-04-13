export interface LocalLibrary {
  id: string
  name: string
  registeredAt: string
  lastSyncedAt?: string
}

export interface CorpusItem {
  id: string
  libraryId: string
  title: string
  mediaType: string
  durationMs: number | null
  opfsPath: string
  sourceFileName: string
  importedAt: string
  status: 'ready' | 'processing' | 'error'
  sizeBytes: number
}

export interface IngestionJob {
  id: string
  libraryId: string
  corpusItemId: string
  status: 'queued' | 'running' | 'complete' | 'error'
  step: string
  progress: number
  error?: string
  createdAt: string
  updatedAt: string
}

export interface TranscriptSegment {
  id: string
  libraryId: string
  corpusItemId: string
  startMs: number
  endMs: number
  text: string
  speaker?: string | null
  tokenCount: number
  embeddingId?: string | null
  createdAt: string
}

export interface ScreenshotRecord {
  id: string
  libraryId: string
  corpusItemId: string
  timestampMs: number
  opfsPath: string
  kind: 'scene_change' | 'manual' | 'interval'
  analysisSummary?: string | null
  createdAt: string
}

export interface EmbeddingRecord {
  id: string
  libraryId: string
  ownerType: string
  ownerId: string
  model: string
  dimensions: number
  vectorBlob: ArrayBuffer
  createdAt: string
}

export interface SearchDocRecord {
  id: string
  libraryId: string
  corpusItemId: string
  segmentId: string
  text: string
  startMs: number
  endMs: number
}

export interface NoteRecord {
  id: string
  libraryId: string
  corpusItemId?: string
  body: string
  createdAt: string
}

export interface TagRecord {
  id: string
  libraryId: string
  label: string
  color?: string
}

export interface ClaimRecord {
  id: string
  libraryId: string
  corpusItemId?: string
  text: string
  confidence?: number
  createdAt: string
}

export interface UiStateRecord {
  id: string
  libraryId: string
  selectedCorpusItemId?: string
  activeThreadId?: string | null
  lastSearchQuery?: string
  lastTimestampMs?: number
}

export interface TranscriptApiSegment {
  id: string
  chunk_index: number
  start_ms: number
  end_ms: number
  text: string
  speaker?: string | null
  token_count: number
  confidence?: number | null
}

export interface EvidenceRef {
  id: string
  title: string
  kind: 'transcript' | 'screenshot'
  corpusItemId: string
  timestampMs: number
  excerpt: string
  screenshotPath?: string
}

export interface EvidenceSegment {
  id: string
  corpusItemId: string
  timestampMs: number
  timestampLabel: string
  text: string
  score: number
  speaker?: string | null
}

export interface EvidenceScreenshot {
  id: string
  corpusItemId: string
  timestampMs: number
  timestampLabel: string
  opfsPath: string
}

export interface EvidenceBundle {
  query: string
  segments: EvidenceSegment[]
  screenshots: EvidenceScreenshot[]
  refs: EvidenceRef[]
}

export interface PreparedChunk {
  id: string
  fileName: string
  mimeType: string
  startMs: number
  endMs: number
  overlapMs: number
  blob: Blob
}

export interface PreparedScreenshot {
  id: string
  timestampMs: number
  blob: Blob
  kind: 'interval'
}

export interface PreparedMedia {
  durationMs: number | null
  chunks: PreparedChunk[]
  screenshots: PreparedScreenshot[]
  warnings: string[]
}
