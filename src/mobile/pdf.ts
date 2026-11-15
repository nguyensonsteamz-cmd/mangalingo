/**
 * PDF → page images for the scan screen (each page can then be scanned, translated, highlighted
 * like a screenshot). pdf.js (legacy build: works on iOS 16 / 17 WebKit) is loaded only when a PDF
 * is opened, so it costs nothing otherwise.
 */
const MAX_PAGES = 60;
const TARGET_WIDTH = 1400; // px – sharp enough for OCR, small enough for memory

export async function renderPdf(file: File, onProgress?: (done: number, total: number) => void): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const total = Math.min(doc.numPages, MAX_PAGES);
  const urls: string[] = [];
  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(3, TARGET_WIDTH / base.width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Không dựng được trang PDF.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Không dựng được trang PDF.'))), 'image/jpeg', 0.9));
    urls.push(URL.createObjectURL(blob));
    page.cleanup();
    onProgress?.(i, total);
  }
  await doc.destroy();
  return urls;
}
