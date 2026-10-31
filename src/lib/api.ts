import type {
  AccountInfo,
  AiEvent,
  AiStatus,
  Application,
  BoardColumn,
  ChangeStamps,
  CoverLetter,
  InviteInfo,
  JobAnalysis,
  JobInfo,
  Lang,
  LetterStyle,
  Library,
  MatchScore,
  Personal,
  Resume,
  ResumeMeta,
  ScrapedJob,
  SearchProfile,
} from '@shared/types'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'X-Requested-With': 'sforza',
      ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`)
  }
  return (await res.json()) as T
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
})

type JobInput = Pick<JobInfo, 'title' | 'company' | 'url' | 'description'>
export type TailorJob = JobInput & { logo?: string; location?: string }
type Progress = (message: string) => void

export const api = {
  me: () =>
    request<{ authenticated: boolean; user: string | null; moveTo?: string; setup?: { needsToken: boolean } }>('/api/auth/me'),
  login: (username: string, password: string) => request<{ ok: true; user: string }>('/api/auth/login', json('POST', { username, password })),
  logout: () => request<{ ok: true }>('/api/auth/logout', json('POST', {})),
  setup: (username: string, password: string, setupToken: string) =>
    request<{ ok: true; user: string }>('/api/auth/setup', json('POST', { username, password, setupToken })),
  join: (code: string, username: string, password: string) =>
    request<{ ok: true; user: string }>('/api/auth/join', json('POST', { code, username, password })),
  changePassword: (current: string, password: string) => request<{ ok: true }>('/api/auth/password', json('POST', { current, password })),
  accounts: () => request<{ accounts: AccountInfo[]; invites: InviteInfo[] }>('/api/accounts'),
  createInvite: () => request<{ url: string; expiresAt: number }>('/api/accounts/invites', json('POST', {})),
  revokeInvite: (id: string) => request<{ ok: true }>(`/api/accounts/invites/${encodeURIComponent(id)}`, json('DELETE')),
  setLocked: (username: string, disabled: boolean) =>
    request<{ ok: true }>(`/api/accounts/${encodeURIComponent(username)}/access`, json('PUT', { disabled })),
  connector: () => request<{ url: string }>('/api/connector'),

  printLetter: (id: string, lang: string, token: string) =>
    request<{ letter: CoverLetter; lang: Lang; personal: Personal; style: LetterStyle; title: string }>(
      `/api/print-letter?id=${encodeURIComponent(id)}&lang=${encodeURIComponent(lang)}&token=${encodeURIComponent(token)}`,
    ),
  printData: (id: string, token: string) =>
    request<Resume>(`/api/print-data?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`),

  changes: () => request<ChangeStamps>('/api/changes'),

  list: () => request<ResumeMeta[]>('/api/resumes'),
  get: (id: string) => request<Resume>(`/api/resumes/${id}`),
  create: (body: { duplicateOf?: string; name?: string }) => request<Resume>('/api/resumes', json('POST', body)),
  save: (resume: Resume) => request<{ updatedAt: string }>(`/api/resumes/${resume.id}`, json('PUT', resume)),
  remove: (id: string) => request<{ ok: true }>(`/api/resumes/${id}`, json('DELETE')),
  setMain: (id: string) => request<{ ok: true }>(`/api/resumes/${id}/main`, json('POST', {})),

  library: () => request<Library>('/api/library'),
  saveLibrary: (lib: Library) => request<{ ok: true }>('/api/library', json('PUT', lib)),
  searchProfile: () => request<SearchProfile>('/api/search-profile'),
  saveSearchProfile: (profile: SearchProfile) => request<SearchProfile>('/api/search-profile', json('PUT', profile)),

  uploadImage: (blob: Blob) =>
    request<{ url: string }>('/api/assets', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } }),

  aiStatus: () => request<AiStatus>('/api/ai/status'),
  tailor: (
    body: {
      baseId: string
      job: TailorJob
      applicationId?: string
      analysis: JobAnalysis | null
      languages: Lang[]
      useLibrary: boolean
      strict: boolean
      /** also write a motivation letter in the posting's language */
      letter?: boolean
    },
    onProgress: Progress,
  ) => streamAi<Resume>('/api/ai/tailor', body, onProgress),
  translate: (body: { id: string; targets: Lang[] }, onProgress: Progress) => streamAi<Resume>('/api/ai/translate', body, onProgress),
  jobFromUrl: (url: string, onProgress: Progress) =>
    streamAi<{ job: ScrapedJob; analysis: JobAnalysis }>('/api/ai/job-from-url', { url }, onProgress),
  match: (body: { resumeId: string; job: JobInput; analysis: JobAnalysis | null }, onProgress: Progress) =>
    streamAi<{ analysis: JobAnalysis; score: MatchScore }>('/api/ai/match', body, onProgress),
  rescore: (id: string, onProgress: Progress, description?: string) => streamAi<Resume>('/api/ai/rescore', { id, description }, onProgress),

  applications: () => request<Application[]>('/api/applications'),
  createApplication: (fields: Partial<Application>) => request<Application>('/api/applications', json('POST', fields)),
  saveApplication: (app: Application) => request<{ updatedAt: string }>(`/api/applications/${app.id}`, json('PUT', app)),
  removeApplication: (id: string) => request<{ ok: true; deletedCv: string | null }>(`/api/applications/${id}`, json('DELETE')),
  boardColumns: () => request<BoardColumn[]>('/api/board-columns'),
  saveBoardColumns: (columns: BoardColumn[]) => request<BoardColumn[]>('/api/board-columns', json('PUT', { columns })),
  /** title, company, location and logo of a job link, without AI */
  readLink: (url: string) => request<ScrapedJob>('/api/applications/read-link', json('POST', { url })),
  findLogo: (id: string) => request<Application>(`/api/applications/${id}/logo`, json('POST', {})),
  /** writes the letter of an application with the site's model and returns the updated card */
  writeLetter: (body: { applicationId: string; lang: Lang }, onProgress: Progress) => streamAi<Application>('/api/ai/letter', body, onProgress),
  importTailored: () => request<Application[]>('/api/applications/import', json('POST', {})),
  /** runs the server's AI-text detector on the CV or a letter and returns the updated card */
  aiCheck: (id: string, doc: 'cv' | 'letter', lang: Lang) => request<Application>(`/api/applications/${id}/ai-check`, json('POST', { doc, lang })),
}

/** Reads the NDJSON event stream of an AI endpoint and resolves with its final payload. */
async function streamAi<T>(path: string, body: unknown, onProgress: Progress): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'sforza' },
    body: JSON.stringify(body),
  })
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(res.status, err?.error ?? `Request failed (${res.status})`)
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (value) buffer += value
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      const event = JSON.parse(line) as AiEvent
      if (event.type === 'progress') onProgress(event.message)
      else if (event.type === 'error') throw new ApiError(500, event.message)
      else if (event.type === 'done') return event.resume as T
      else if (event.type === 'result') return event.result as T
    }
    if (done) break
  }
  throw new ApiError(500, 'The AI request ended unexpectedly. Please retry.')
}
