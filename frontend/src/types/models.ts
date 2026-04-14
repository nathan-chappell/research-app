export interface LocalLibrary {
  id: string
  name: string
  registeredAt: string
  lastSyncedAt?: string
}

export type WatchCaptureMode = 'audio' | 'audio_video'

export type WatchTargetMode = 'iframe' | 'direct_tab'

export type WatchPopupStatus = 'closed' | 'opening' | 'ready' | 'blocked'

export type WatchRecordingStatus = 'idle' | 'capturing' | 'stopping' | 'error'

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
  sourceKind?: 'upload' | 'watch_capture'
  sourceUrl?: string
  captureSessionId?: string
  captureChunkIndex?: number
  captureMode?: WatchCaptureMode
  captureStartedAt?: string
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
  retrievalBackend?: string
}

export interface SemanticCapabilities {
  enabled: boolean
  retrievalBackend: string
  fallbackBackend?: string | null
  embeddingModel: string
  embeddingDimensions: number
  workingSetSize: number
}

export interface SemanticSearchFilters {
  corpusItemIds?: string[]
}

export interface SemanticSearchHit {
  id: string
  corpusItemId: string
  title: string
  sourceFileName: string
  text: string
  startMs: number
  endMs: number
  speaker?: string | null
  tokenCount: number
  score: number
  embedding: number[]
}

export interface ThemeRepresentative {
  id: string
  text: string
  title?: string
  timestampMs?: number
}

export interface ExplorePoint {
  id: string
  corpusItemId: string
  title: string
  sourceFileName: string
  text: string
  startMs: number
  endMs: number
  speaker?: string | null
  score: number
  clusterId: number
  x: number
  y: number
}

export interface ExploreCluster {
  clusterId: number
  representativeIds: string[]
  representatives: ThemeRepresentative[]
}

export interface ClusterTheme {
  clusterId: number
  label: string
  explanation: string
  representativeIds: string[]
}

export interface ExploreSession {
  query: string
  retrievalBackend: string
  hits: SemanticSearchHit[]
  points: ExplorePoint[]
  clusters: ExploreCluster[]
  themes: ClusterTheme[]
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

export interface WatchSessionState {
  captureSessionId: string
  targetUrl: string
  normalizedUrl?: string
  targetMode: WatchTargetMode
  captureMode: WatchCaptureMode
  popupStatus: WatchPopupStatus
  recordingStatus: WatchRecordingStatus
  currentChunkIndex: number
  chunkStartedAt?: string
  captureStartedAt?: string
  pendingImports: number
  importedChunks: number
  error?: string
}
