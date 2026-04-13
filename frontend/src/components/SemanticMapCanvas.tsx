import { useEffect, useMemo, useRef } from 'react'

import type { ExplorePoint } from '../types/models'

const CLUSTER_COLORS = ['#d94841', '#12836a', '#3f67d6', '#d27c00', '#9a3fd6', '#007a9b', '#8a4f1d', '#7f3a52']

export function clusterColor(clusterId: number) {
  return CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length]
}

interface SemanticMapCanvasProps {
  points: ExplorePoint[]
  selectedPointId?: string
  onSelectPoint: (point: ExplorePoint) => void
}

export function SemanticMapCanvas({
  points,
  selectedPointId,
  onSelectPoint,
}: SemanticMapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointPositions = useMemo(() => new Map<string, { x: number; y: number }>(), [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.floor(bounds.width * ratio))
      canvas.height = Math.max(1, Math.floor(bounds.height * ratio))
      context.setTransform(ratio, 0, 0, ratio, 0, 0)

      context.clearRect(0, 0, bounds.width, bounds.height)
      context.fillStyle = '#f8fcf9'
      context.fillRect(0, 0, bounds.width, bounds.height)

      if (points.length === 0) {
        return
      }

      const padding = 28
      const xValues = points.map((point) => point.x)
      const yValues = points.map((point) => point.y)
      const xMin = Math.min(...xValues)
      const xMax = Math.max(...xValues)
      const yMin = Math.min(...yValues)
      const yMax = Math.max(...yValues)
      const xSpan = xMax - xMin || 1
      const ySpan = yMax - yMin || 1

      pointPositions.clear()

      context.strokeStyle = '#d7e6dd'
      context.lineWidth = 1
      context.strokeRect(0.5, 0.5, bounds.width - 1, bounds.height - 1)

      for (const point of points) {
        const x = padding + ((point.x - xMin) / xSpan) * Math.max(1, bounds.width - padding * 2)
        const y =
          bounds.height -
          padding -
          ((point.y - yMin) / ySpan) * Math.max(1, bounds.height - padding * 2)
        pointPositions.set(point.id, { x, y })

        context.beginPath()
        context.fillStyle = clusterColor(point.clusterId)
        context.globalAlpha = point.id === selectedPointId ? 1 : 0.86
        context.arc(x, y, point.id === selectedPointId ? 7 : 4.5, 0, Math.PI * 2)
        context.fill()

        if (point.id === selectedPointId) {
          context.lineWidth = 2
          context.strokeStyle = '#16251c'
          context.stroke()
        }
      }

      context.globalAlpha = 1
    }

    resize()
    const observer = new ResizeObserver(() => resize())
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [pointPositions, points, selectedPointId])

  return (
    <canvas
      ref={canvasRef}
      onClick={(event) => {
        const canvas = canvasRef.current
        if (!canvas) return
        const bounds = canvas.getBoundingClientRect()
        const clickX = event.clientX - bounds.left
        const clickY = event.clientY - bounds.top
        const nearest = points
          .map((point) => {
            const position = pointPositions.get(point.id)
            if (!position) return null
            const distance = Math.hypot(position.x - clickX, position.y - clickY)
            return { point, distance }
          })
          .filter(Boolean)
          .sort((left, right) => left!.distance - right!.distance)[0]

        if (nearest && nearest.distance < 24) {
          onSelectPoint(nearest.point)
        }
      }}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        borderRadius: 8,
        cursor: points.length > 0 ? 'crosshair' : 'default',
      }}
    />
  )
}
