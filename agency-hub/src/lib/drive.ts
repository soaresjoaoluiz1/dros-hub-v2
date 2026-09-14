// =====================================================================
// Helpers pra embutir arquivos publicos do Google Drive em <iframe>
//
// O Drive aceita /preview pra qualquer tipo de arquivo (video, imagem, PDF,
// docs, sheets, slides). Pre-requisito: link compartilhado como "qualquer
// pessoa com o link" — caso contrario o iframe mostra "voce precisa fazer
// login".
// =====================================================================

const FILE_ID = /[a-zA-Z0-9_-]+/.source

const PATTERNS: Array<{ re: RegExp; embed: (id: string) => string }> = [
  // https://drive.google.com/file/d/ID/view  (videos, imagens, PDFs, etc)
  { re: new RegExp(`drive\\.google\\.com/file/d/(${FILE_ID})`), embed: (id) => `https://drive.google.com/file/d/${id}/preview` },
  // https://drive.google.com/open?id=ID
  { re: new RegExp(`drive\\.google\\.com/open\\?id=(${FILE_ID})`), embed: (id) => `https://drive.google.com/file/d/${id}/preview` },
  // https://drive.google.com/uc?id=ID&...
  { re: new RegExp(`drive\\.google\\.com/uc\\?[^#]*[?&]?id=(${FILE_ID})`), embed: (id) => `https://drive.google.com/file/d/${id}/preview` },
  // https://docs.google.com/document/d/ID/...
  { re: new RegExp(`docs\\.google\\.com/document/d/(${FILE_ID})`), embed: (id) => `https://docs.google.com/document/d/${id}/preview` },
  // https://docs.google.com/spreadsheets/d/ID/...
  { re: new RegExp(`docs\\.google\\.com/spreadsheets/d/(${FILE_ID})`), embed: (id) => `https://docs.google.com/spreadsheets/d/${id}/preview` },
  // https://docs.google.com/presentation/d/ID/...
  { re: new RegExp(`docs\\.google\\.com/presentation/d/(${FILE_ID})`), embed: (id) => `https://docs.google.com/presentation/d/${id}/preview` },
]

export function isDriveUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return PATTERNS.some(p => p.re.test(url))
}

export function toDriveEmbedUrl(url: string | null | undefined): string | null {
  if (!url) return null
  for (const p of PATTERNS) {
    const m = url.match(p.re)
    if (m) return p.embed(m[1])
  }
  return null
}
