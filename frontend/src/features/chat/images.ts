import type { ImageCreate, ImageCreateMediaType } from '../../api/generated/model'

// Mirror the backend limits in ImageCreate / MessageCreate (app/schemas.py).
export const MAX_IMAGES = 4
export const MAX_IMAGE_BYTES = 3_000_000
export const IMAGE_TYPES: ImageCreateMediaType[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]

/** An image picked for the next message: what is sent, plus a URL to preview it. */
export interface PendingImage extends ImageCreate {
  url: string
  name: string
}

function isImageType(type: string): type is ImageCreateMediaType {
  return (IMAGE_TYPES as string[]).includes(type)
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error('Could not read the image'))
    }
    reader.readAsDataURL(file)
  })
}

/** Read the files as images for a message; throws a message for the user when one can't be
 * sent. */
export async function readImages(files: File[], alreadyPicked: number): Promise<PendingImage[]> {
  if (alreadyPicked + files.length > MAX_IMAGES) {
    throw new Error(`Attach up to ${String(MAX_IMAGES)} images.`)
  }
  return Promise.all(
    files.map(async (file) => {
      if (!isImageType(file.type)) throw new Error('Use PNG, JPEG, GIF or WebP images.')
      if (file.size > MAX_IMAGE_BYTES) throw new Error('Images can be at most 3 MB.')
      const data = await readAsBase64(file)
      return {
        media_type: file.type,
        data,
        url: `data:${file.type};base64,${data}`,
        name: file.name,
      }
    }),
  )
}

export const attachmentUrl = (id: number) => `/api/attachments/${String(id)}`
