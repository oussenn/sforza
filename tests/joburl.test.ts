import { describe, expect, it } from 'vitest'
import { jobUrlKey } from '@shared/utils'

describe('jobUrlKey: the same posting twice, different postings apart', () => {
  it('drops tracking and language parameters', () => {
    expect(jobUrlKey('https://www.linkedin.com/jobs/view/4478459396/?trk=abc&utm_source=x')).toBe(jobUrlKey('https://linkedin.com/jobs/view/4478459396'))
    expect(jobUrlKey('https://jobs.example.com/job/1?locale=en_US')).toBe(jobUrlKey('https://jobs.example.com/job/1'))
  })

  it('keeps the job route of a single-page career site', () => {
    const a = 'https://jobs.amazon.de/app#/jobDetail?jobId=a0Rar0000020KCKEA2&locale=en-DE'
    expect(jobUrlKey(a)).toBe(jobUrlKey('https://jobs.amazon.de/app#/jobDetail?jobId=a0Rar0000020KCKEA2'))
    expect(jobUrlKey(a)).not.toBe(jobUrlKey('https://jobs.amazon.de/app#/jobDetail?jobId=b1Sbs1111131LDLFB3'))
  })

  it('ignores a plain anchor', () => {
    expect(jobUrlKey('https://example.com/careers/42#apply')).toBe(jobUrlKey('https://example.com/careers/42'))
  })

  it('keys a LinkedIn job by its id, from search results or the job page', () => {
    const search = 'https://www.linkedin.com/jobs/search-results/?currentJobId=4442100467&eBP=CwEAAAGh&refId=rBo%3D&keywords=werkstudent&geoId=103243965'
    expect(jobUrlKey(search)).toBe(jobUrlKey('https://de.linkedin.com/jobs/view/studentische-aushilfe-m-w-d-at-lacoste-4442100467'))
    expect(jobUrlKey(search)).not.toBe(jobUrlKey('https://www.linkedin.com/jobs/view/4442100468'))
  })
})
