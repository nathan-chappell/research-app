import { kmeans } from 'ml-kmeans'
import { Matrix } from 'ml-matrix'
import { UMAP } from 'umap-js'

import type { ExploreCluster, ExplorePoint, SemanticSearchHit } from '../types/models'

type WorkerRequest = {
  id: string
  type: 'analyze'
  payload: {
    hits: SemanticSearchHit[]
    k: number
  }
}

type WorkerResponse =
  | {
      id: string
      ok: true
      result: {
        points: ExplorePoint[]
        clusters: ExploreCluster[]
      }
    }
  | {
      id: string
      ok: false
      error: string
    }

function squaredDistance(left: number[], right: number[]) {
  let total = 0
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0)
    total += delta * delta
  }
  return total
}

function analyze(hits: SemanticSearchHit[], requestedK: number) {
  const usableHits = hits.filter((hit) => hit.embedding.length > 0)
  if (usableHits.length === 0) {
    throw new Error('No embeddings are available for the selected working set.')
  }

  if (usableHits.length === 1) {
    const onlyHit = usableHits[0]
    return {
      points: [
        {
          id: onlyHit.id,
          corpusItemId: onlyHit.corpusItemId,
          title: onlyHit.title,
          sourceFileName: onlyHit.sourceFileName,
          text: onlyHit.text,
          startMs: onlyHit.startMs,
          endMs: onlyHit.endMs,
          speaker: onlyHit.speaker,
          score: onlyHit.score,
          clusterId: 0,
          x: 0,
          y: 0,
        },
      ],
      clusters: [
        {
          clusterId: 0,
          representativeIds: [onlyHit.id],
          representatives: [
            {
              id: onlyHit.id,
              text: onlyHit.text,
              title: onlyHit.title,
              timestampMs: onlyHit.startMs,
            },
          ],
        },
      ],
    }
  }

  const matrix = new Matrix(usableHits.map((hit) => hit.embedding))
  const data = matrix.to2DArray()
  const clusterCount = Math.max(1, Math.min(requestedK, usableHits.length))
  const kmeansResult =
    clusterCount === 1
      ? { clusters: usableHits.map(() => 0), centroids: [data[0]] }
      : kmeans(data, clusterCount, {
          initialization: 'kmeans++',
          maxIterations: 100,
        })

  const layout =
    usableHits.length <= 2
      ? usableHits.map((_, index) => [index * 2 - 1, 0])
      : new UMAP({
          nComponents: 2,
          nNeighbors: Math.max(2, Math.min(15, usableHits.length - 1)),
          minDist: 0.1,
        }).fit(data)

  const points: ExplorePoint[] = usableHits.map((hit, index) => ({
    id: hit.id,
    corpusItemId: hit.corpusItemId,
    title: hit.title,
    sourceFileName: hit.sourceFileName,
    text: hit.text,
    startMs: hit.startMs,
    endMs: hit.endMs,
    speaker: hit.speaker,
    score: hit.score,
    clusterId: kmeansResult.clusters[index] ?? 0,
    x: layout[index]?.[0] ?? 0,
    y: layout[index]?.[1] ?? 0,
  }))

  const clusters: ExploreCluster[] = Array.from({ length: clusterCount }, (_, clusterId) => {
    const members = usableHits
      .map((hit, index) => ({ hit, index }))
      .filter((entry) => (kmeansResult.clusters[entry.index] ?? 0) === clusterId)

    const representatives = members
      .map((entry) => ({
        id: entry.hit.id,
        text: entry.hit.text,
        title: entry.hit.title,
        timestampMs: entry.hit.startMs,
        distance: squaredDistance(entry.hit.embedding, kmeansResult.centroids[clusterId] ?? []),
      }))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 5)

    return {
      clusterId,
      representativeIds: representatives.map((representative) => representative.id),
      representatives: representatives.map(({ distance: _distance, ...representative }) => representative),
    }
  })

  return { points, clusters }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const { data } = event
    if (data.type !== 'analyze') {
      self.postMessage({ id: data.id, ok: false, error: 'Unsupported explore worker message.' })
      return
    }

    self.postMessage({
      id: data.id,
      ok: true,
      result: analyze(data.payload.hits, data.payload.k),
    } satisfies WorkerResponse)
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Explore analysis failed.',
    } satisfies WorkerResponse)
  }
}
