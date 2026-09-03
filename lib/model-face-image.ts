import sharp from 'sharp';

export const MODEL_FACE_JPEG_QUALITY = 88;
export const MODEL_FACE_THUMBNAIL_WIDTH = 256;

export async function prepareModelFaceImage(imageBase64: string) {
  const source = sharp(Buffer.from(imageBase64, 'base64')).rotate();
  const [image, thumbnail] = await Promise.all([
    source.clone().jpeg({ quality: MODEL_FACE_JPEG_QUALITY }).toBuffer(),
    source.clone()
      .resize({ width: MODEL_FACE_THUMBNAIL_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: MODEL_FACE_JPEG_QUALITY })
      .toBuffer(),
  ]);
  return {
    image: image.toString('base64'),
    thumbnail: thumbnail.toString('base64'),
    mimeType: 'image/jpeg' as const,
  };
}
