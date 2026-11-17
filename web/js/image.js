/**
 * 업로드 전 사진 줄이기
 *  - 긴 변을 maxSide(기본 1280px)로 줄이고 JPEG로 다시 인코딩
 *  - 폰 사진(3~5MB) → 보통 150~400KB. Storage 버킷 제한(2MB, JPEG만)을 항상 통과하도록 품질을 단계적으로 낮춤
 *  - createImageBitmap은 대부분 브라우저에서 EXIF 회전을 자동 반영
 */
export async function shrinkImage(file, { maxSide = 1280, maxBytes = 1.9 * 1024 * 1024 } = {}) {
  let src;
  try {
    src = await createImageBitmap(file);
  } catch {
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image_decode_failed'));
      img.src = URL.createObjectURL(file);
    });
  }
  const k = Math.min(1, maxSide / Math.max(src.width, src.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(src.width * k);
  canvas.height = Math.round(src.height * k);
  canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);

  for (const quality of [0.85, 0.72, 0.6, 0.45]) {
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
    if (blob && blob.size <= maxBytes) return blob;
  }
  throw new Error('image_too_large');
}
