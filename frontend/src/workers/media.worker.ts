import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'

const ffmpeg = new FFmpeg()
let ffmpegLoaded = false

async function ensureFfmpeg() {
  if (ffmpegLoaded) return
  await ffmpeg.load()
  ffmpegLoaded = true
}

async function readTextFile(path: string) {
  const text = await ffmpeg.readFile(path, 'utf8')
  return typeof text === 'string' ? text : new TextDecoder().decode(text as Uint8Array)
}

async function probeDuration(inputPath: string) {
  await ffmpeg.ffprobe([
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    inputPath,
    '-o',
    'duration.txt',
  ])
  const durationText = (await readTextFile('duration.txt')).trim()
  return Number.parseFloat(durationText) * 1000 || null
}

async function prepareWithFfmpeg(fileName: string, mimeType: string, fileData: ArrayBuffer) {
  const inputPath = `input-${Date.now()}-${fileName}`
  const audioPath = `audio-${Date.now()}.mp3`
  const warnings: string[] = []

  await ensureFfmpeg()
  await ffmpeg.writeFile(inputPath, await fetchFile(new Blob([fileData], { type: mimeType })))
  const durationMs = await probeDuration(inputPath)

  await ffmpeg.exec([
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-b:a',
    '64k',
    audioPath,
  ])

  const chunkLengthSec = 20 * 60
  const stepSec = chunkLengthSec - 2
  const totalDurationSec = Math.max(1, Math.ceil((durationMs ?? 0) / 1000))
  const chunks: Array<{
    id: string
    fileName: string
    mimeType: string
    startMs: number
    endMs: number
    overlapMs: number
    data: ArrayBuffer
  }> = []

  let chunkIndex = 0
  for (let startSec = 0; startSec < totalDurationSec || chunkIndex === 0; startSec += stepSec) {
    const chunkPath = `chunk-${chunkIndex}.mp3`
    const remaining = Math.max(1, totalDurationSec - startSec)
    const durationSec = Math.min(chunkLengthSec, remaining)
    await ffmpeg.exec([
      '-ss',
      `${startSec}`,
      '-t',
      `${durationSec}`,
      '-i',
      audioPath,
      '-acodec',
      'copy',
      chunkPath,
    ])
    const data = await ffmpeg.readFile(chunkPath)
    chunks.push({
      id: `chunk_${chunkIndex}`,
      fileName: chunkPath,
      mimeType: 'audio/mpeg',
      startMs: Math.round(startSec * 1000),
      endMs: Math.round((startSec + durationSec) * 1000),
      overlapMs: chunkIndex === 0 ? 0 : 2000,
      data: Uint8Array.from(data as Uint8Array).buffer,
    })
    chunkIndex += 1
    if (remaining <= chunkLengthSec) break
  }

  const screenshots: Array<{
    id: string
    timestampMs: number
    fileName: string
    data: ArrayBuffer
  }> = []

  if (mimeType.startsWith('video/') && durationMs) {
    for (const position of [0.15, 0.5, 0.85]) {
      const timestampMs = Math.round(durationMs * position)
      const outputPath = `screenshot-${Math.round(position * 100)}.jpg`
      try {
        await ffmpeg.exec([
          '-ss',
          `${timestampMs / 1000}`,
          '-i',
          inputPath,
          '-frames:v',
          '1',
          '-q:v',
          '4',
          outputPath,
        ])
        const image = await ffmpeg.readFile(outputPath)
        screenshots.push({
          id: outputPath.replace('.jpg', ''),
          timestampMs,
          fileName: outputPath,
          data: Uint8Array.from(image as Uint8Array).buffer,
        })
      } catch {
        warnings.push('A video frame could not be extracted for one of the preview screenshots.')
      }
    }
  }

  return { durationMs, chunks, screenshots, warnings }
}

function fallbackPrepare(fileName: string, mimeType: string, fileData: ArrayBuffer) {
  return {
    durationMs: null,
    warnings: [
      'ffmpeg.wasm was unavailable, so the app kept the import in a single upload-sized chunk.',
    ],
    chunks: [
      {
        id: 'chunk_0',
        fileName,
        mimeType,
        startMs: 0,
        endMs: 0,
        overlapMs: 0,
        data: fileData,
      },
    ],
    screenshots: [],
  }
}

self.onmessage = async (
  event: MessageEvent<{
    id: string
    type: 'prepare-media'
    payload: { fileName: string; mimeType: string; fileData: ArrayBuffer }
  }>,
) => {
  const { id, payload } = event.data
  try {
    let result
    try {
      result = await prepareWithFfmpeg(payload.fileName, payload.mimeType, payload.fileData)
    } catch {
      result = fallbackPrepare(payload.fileName, payload.mimeType, payload.fileData)
    }
    self.postMessage({ id, ok: true, result })
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Media preparation failed.',
    })
  }
}
