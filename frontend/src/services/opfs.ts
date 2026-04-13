const textEncoder = new TextEncoder()

function splitPath(path: string) {
  return path.split('/').filter(Boolean)
}

export async function getOpfsRoot() {
  return navigator.storage.getDirectory()
}

async function getDirectoryHandle(path: string, create = true) {
  const root = await getOpfsRoot()
  let current = root
  for (const part of splitPath(path)) {
    current = await current.getDirectoryHandle(part, { create })
  }
  return current
}

async function getFileHandle(path: string, create = true) {
  const parts = splitPath(path)
  const fileName = parts.pop()
  if (!fileName) throw new Error('Invalid OPFS file path.')
  const directory = await getDirectoryHandle(parts.join('/'), create)
  return directory.getFileHandle(fileName, { create })
}

export async function writeBlob(path: string, blob: Blob | File) {
  const fileHandle = await getFileHandle(path, true)
  const writable = await fileHandle.createWritable()
  await writable.write(blob)
  await writable.close()
  return path
}

export async function writeJson(path: string, value: unknown) {
  return writeBlob(path, new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
}

export async function writeText(path: string, value: string) {
  return writeBlob(path, new Blob([textEncoder.encode(value)], { type: 'text/plain' }))
}

export async function readBlob(path: string) {
  const handle = await getFileHandle(path, false)
  const file = await handle.getFile()
  return file
}

export async function readObjectUrl(path: string) {
  const blob = await readBlob(path)
  return URL.createObjectURL(blob)
}

export function sourceOpfsPath(libraryId: string, corpusItemId: string, fileName: string) {
  return `/libraries/${libraryId}/media/${corpusItemId}/source/${fileName}`
}

export function audioChunkOpfsPath(
  libraryId: string,
  corpusItemId: string,
  fileName: string,
) {
  return `/libraries/${libraryId}/media/${corpusItemId}/audio-chunks/${fileName}`
}

export function screenshotOpfsPath(
  libraryId: string,
  corpusItemId: string,
  fileName: string,
) {
  return `/libraries/${libraryId}/media/${corpusItemId}/screenshots/${fileName}`
}
