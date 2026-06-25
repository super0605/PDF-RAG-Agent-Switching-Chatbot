/**
 * PDF text extraction with pdf.js, plus simple word-based chunking.
 * Runs entirely in the browser — no server-side parsing needed for the demo.
 */
import * as pdfjsLib from 'pdfjs-dist'
// Vite resolves this to a hashed URL for the worker bundle.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export interface PdfPageText {
  page: number
  text: string
}

/** Extract text per page from a PDF file. */
export async function extractPdfText(file: File): Promise<PdfPageText[]> {
  const buffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const pages: PdfPageText[] = []

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    pages.push({ page: pageNum, text })
  }

  return pages
}

export interface Chunk {
  id: number
  page: number
  text: string
}

/**
 * Split page text into overlapping word windows. Overlap keeps sentences that
 * straddle a boundary retrievable from at least one chunk.
 */
export function chunkPages(
  pages: PdfPageText[],
  wordsPerChunk = 180,
  overlap = 40,
): Chunk[] {
  const chunks: Chunk[] = []
  let id = 0

  for (const { page, text } of pages) {
    const words = text.split(' ').filter(Boolean)
    if (words.length === 0) continue

    const step = Math.max(1, wordsPerChunk - overlap)
    for (let start = 0; start < words.length; start += step) {
      const slice = words.slice(start, start + wordsPerChunk)
      if (slice.length === 0) break
      chunks.push({ id: id++, page, text: slice.join(' ') })
      if (start + wordsPerChunk >= words.length) break
    }
  }

  return chunks
}
