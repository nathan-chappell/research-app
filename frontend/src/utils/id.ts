import { v4 as uuid } from 'uuid'

export function makeId(prefix: string) {
  return `${prefix}_${uuid().replaceAll('-', '').slice(0, 12)}`
}
