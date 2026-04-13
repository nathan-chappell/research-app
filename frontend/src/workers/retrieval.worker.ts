import MiniSearch from 'minisearch'

type IndexedDocument = {
  id: string
  libraryId: string
  corpusItemId: string
  segmentId: string
  text: string
  startMs: number
  endMs: number
  vector?: number[]
}

type WorkerState = {
  search: MiniSearch<IndexedDocument>
  documents: IndexedDocument[]
}

const states = new Map<string, WorkerState>()

function cosineSimilarity(left: number[], right: number[]) {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0
    const rightValue = right[index] ?? 0
    dot += leftValue * rightValue
    leftNorm += leftValue * leftValue
    rightNorm += rightValue * rightValue
  }

  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

self.onmessage = (
  event: MessageEvent<
    | {
        id: string
        type: 'build-index'
        payload: { libraryId: string; documents: IndexedDocument[] }
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
  >,
) => {
  const { data } = event

  if (data.type === 'build-index') {
    const search = new MiniSearch<IndexedDocument>({
      fields: ['text'],
      storeFields: ['id', 'libraryId', 'corpusItemId', 'segmentId', 'text', 'startMs', 'endMs'],
      searchOptions: { prefix: true, fuzzy: 0.15 },
    })
    search.addAll(data.payload.documents)
    states.set(data.payload.libraryId, {
      search,
      documents: data.payload.documents,
    })
    self.postMessage({ id: data.id, ok: true, result: { hits: [] } })
    return
  }

  const state = states.get(data.payload.libraryId)
  if (!state) {
    self.postMessage({ id: data.id, ok: false, error: 'Index not built.' })
    return
  }

  const lexicalHits = data.payload.query
    ? state.search.search(data.payload.query, { combineWith: 'OR' })
    : []
  const scores = new Map<string, number>()

  lexicalHits.forEach((hit) => {
    scores.set(hit.id, (scores.get(hit.id) ?? 0) + hit.score * 0.6)
  })

  if (data.payload.queryVector) {
    state.documents.forEach((document) => {
      if (!document.vector) return
      const score = cosineSimilarity(data.payload.queryVector!, document.vector)
      scores.set(document.id, (scores.get(document.id) ?? 0) + score * 0.4)
    })
  }

  const allowedCorpusItemIds = new Set(data.payload.corpusItemIds ?? [])
  const hits = state.documents
    .filter((document) => {
      if (allowedCorpusItemIds.size === 0) return true
      return allowedCorpusItemIds.has(document.corpusItemId)
    })
    .map((document) => ({ ...document, score: scores.get(document.id) ?? 0 }))
    .filter((document) => document.score > 0 || !data.payload.query)
    .sort((left, right) => right.score - left.score)
    .slice(0, data.payload.topK)

  self.postMessage({ id: data.id, ok: true, result: { hits } })
}
