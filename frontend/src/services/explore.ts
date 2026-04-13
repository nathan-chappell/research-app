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

class ExploreWorkerClient {
  private worker: Worker
  private pending = new Map<string, { resolve: (value: WorkerResponse) => void; reject: (reason?: unknown) => void }>()

  constructor() {
    this.worker = new Worker(new URL('../workers/explore.worker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const pending = this.pending.get(event.data.id)
      if (!pending) return
      this.pending.delete(event.data.id)
      pending.resolve(event.data)
    }
  }

  async analyze(hits: SemanticSearchHit[], k: number) {
    const id = `explore_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const response = await new Promise<WorkerResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({
        id,
        type: 'analyze',
        payload: { hits, k },
      } satisfies WorkerRequest)
    })
    if (!response.ok) {
      throw new Error(response.error)
    }
    return response.result
  }
}

export const exploreWorkerClient = new ExploreWorkerClient()
