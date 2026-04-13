import Dexie, { type Table } from 'dexie'

import type {
  ClaimRecord,
  CorpusItem,
  EmbeddingRecord,
  IngestionJob,
  LocalLibrary,
  NoteRecord,
  ScreenshotRecord,
  SearchDocRecord,
  TagRecord,
  TranscriptSegment,
  UiStateRecord,
} from '../types/models'

class ResearchDb extends Dexie {
  libraries!: Table<LocalLibrary, string>
  corpusItems!: Table<CorpusItem, string>
  ingestionJobs!: Table<IngestionJob, string>
  transcriptSegments!: Table<TranscriptSegment, string>
  screenshots!: Table<ScreenshotRecord, string>
  embeddings!: Table<EmbeddingRecord, string>
  searchDocs!: Table<SearchDocRecord, string>
  notes!: Table<NoteRecord, string>
  tags!: Table<TagRecord, string>
  claims!: Table<ClaimRecord, string>
  uiState!: Table<UiStateRecord, string>

  constructor() {
    super('research-app')

    this.version(1).stores({
      libraries: 'id, registeredAt',
      corpusItems: 'id, libraryId, [libraryId+importedAt], [libraryId+status]',
      ingestionJobs: 'id, libraryId, corpusItemId, [libraryId+updatedAt]',
      transcriptSegments:
        'id, libraryId, corpusItemId, [libraryId+corpusItemId+startMs], [libraryId+startMs]',
      screenshots:
        'id, libraryId, corpusItemId, [libraryId+corpusItemId+timestampMs]',
      embeddings: 'id, libraryId, ownerType, ownerId, [libraryId+ownerId]',
      searchDocs: 'id, libraryId, corpusItemId, segmentId, [libraryId+corpusItemId]',
      notes: 'id, libraryId, corpusItemId, createdAt',
      tags: 'id, libraryId, label',
      claims: 'id, libraryId, corpusItemId, createdAt',
      uiState: 'id, libraryId',
    })
  }
}

export const db = new ResearchDb()
