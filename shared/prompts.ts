import type { SearchProfile } from './types'
import { GERMAN_LIMIT_LABELS, JOB_TYPE_LABELS } from './types'
import { searchesGermany } from './utils'

/**
 * Ready-made prompts for Claude (Desktop or claude.ai) driving Sforza through its MCP tools.
 * Served as MCP prompts (Claude's "+" menu → the connector) and shown on the Profile page to copy.
 */

export interface PromptContext {
  profile: SearchProfile
  /** AI-text detector available on the server, e.g. "AI or Not"; null = use one in the browser */
  detector: string | null
  /** GitHub profile link from the master CV */
  github: string
}

export interface PromptArg {
  name: string
  description: string
  required: boolean
  /** short hint for the input on the Profile page */
  placeholder: string
}

export interface ClaudePrompt {
  name: string
  title: string
  description: string
  args: PromptArg[]
  build: (ctx: PromptContext, args: Record<string, string>) => string
}

const lines = (...parts: (string | false | null | undefined)[]) => parts.filter((p) => typeof p === 'string').join('\n')

const MODE_LABELS = { onsite: 'on-site', hybrid: 'hybrid', remote: 'remote' } as const

function wishes(p: SearchProfile, focus?: string): string {
  const germany = searchesGermany(p)
  const where = `${p.locations || 'near the city on my CV'}${p.radiusKm ? ` (radius about ${p.radiusKm} km)` : ''}`
  return [
    'What I am looking for:',
    `- Roles: ${p.roles || 'roles that fit my CV and knowledge base'}`,
    p.jobTypes.length > 0 && `- Job types: ${p.jobTypes.map((t) => (germany ? JOB_TYPE_LABELS[t] : JOB_TYPE_LABELS[t].replace(/\s*\(.*\)$/, ''))).join(', ')}`,
    `- Country: ${germany ? 'Germany' : p.country.trim()}`,
    `- Where: ${where}`,
    p.workModes.length > 0 && `- Work mode: ${p.workModes.map((m) => MODE_LABELS[m]).join(', ')}`,
    germany && `- German: my level is ${p.germanLevel || 'the one on my CV'}. Apply only where the requirement is: ${GERMAN_LIMIT_LABELS[p.germanLimit]}.`,
    p.availability && `- Availability: ${p.availability}`,
    p.start && `- Earliest start: ${p.start}`,
    p.salary && `- Salary: ${p.salary}`,
    p.workPermit && `- Work permit: ${p.workPermit}`,
    p.targets && `- Prefer: ${p.targets}`,
    p.avoid && `- Avoid: ${p.avoid}`,
    p.notes && `- Also: ${p.notes}`,
    focus && `- Focus of this run: ${focus}`,
  ]
    .filter(Boolean)
    .join('\n')
}

const JOB_KIND_RULES = `Job kinds: an "Ausbildung" is a full-time vocational apprenticeship of 2 to 3 years with vocational school in German, not a student job; "Werkstudent", "studentische Hilfskraft" / "HiWi" and "Praktikum" are. Full-time roles and apprenticeships break a 20 h/week student permit.`

const GERMAN_RULES = `Reading the German requirement: "fließend", "verhandlungssicher", "sehr gute Deutschkenntnisse", C1 or C2 mean fluent; "gute Deutschkenntnisse" means about B2; "Grundkenntnisse" means A2–B1; "Deutsch wünschenswert" / "von Vorteil" / "nice to have" is not a requirement. A posting written only in German that says nothing about English usually expects at least B2. "Englisch als Arbeitssprache", "English-speaking team" or an English posting at a German company are good signs.`

/** How to read postings in the search country: German-level and job-kind rules only for Germany. */
function marketRules(p: SearchProfile): string {
  if (searchesGermany(p)) return `${GERMAN_RULES}
${JOB_KIND_RULES}`
  return `Job market: ${p.country.trim()}. Search there only, in the country's own job boards and language; ignore the German-specific rules (German levels, Werkstudent, Bundesagentur). Read each posting's language requirement against the languages on my CV. Job kinds: only the job types listed above, and only roles whose hours fit my work-permit limits (a student visa usually caps term-time hours).`
}

/** Where to search when the profile lists no sites of its own. */
function defaultSources(p: SearchProfile): string {
  if (searchesGermany(p))
    return 'search_jobs (Bundesagentur für Arbeit) with several German and English keyword variants for my roles, then in the browser LinkedIn Jobs, Indeed (de.indeed.com), StepStone and the career pages of companies that fit'
  const uk = /^(uk|gb|united kingdom|great britain|england|scotland|wales|northern ireland)$/i.test(p.country.trim())
  return `web search and the browser (search_jobs covers Germany only, do not use it): LinkedIn Jobs and Indeed for ${p.country.trim()}${
    uk ? ", Reed, Totaljobs, CV-Library, StudentJob UK and my university's careers service" : ", the country's main job boards and my university's careers service"
  }, plus the career pages of companies that fit, with several keyword variants for my roles`
}

function languageRule(p: SearchProfile): string {
  switch (p.docLangs) {
    case 'posting':
      return "Write the CV and the letter in the posting's language (German posting: German, English posting: English)."
    case 'posting+en':
      return "Write the CV and the letter in the posting's language, and also in English when the posting is not in English."
    case 'en':
      return 'Write the CV and the letter in English.'
    case 'all':
      return 'Prepare the CV and the letter in English, German and French.'
  }
}

function detectorRule(ctx: PromptContext): string {
  const target = ctx.profile.maxAiPercent
  const how = ctx.detector
    ? `Letters are checked automatically by the site's ${ctx.detector} detector when you save them (the ai_check in the reply of save_motivation_letter); use check_ai_text for a CV whose bullets you rephrased.`
    : 'Use the browser you have (the Claude Desktop built-in browser, or Chrome), where I am signed in. Check each draft with GPTZero (gptzero.me); once a letter passes, confirm the final version once with Pangram (pangram.com), the most accurate detector in independent tests, and record both results. Free quotas are small: always check the letters; check the CV only if you rephrased its bullets (lines taken word for word from my CV are mine). Never use ZeroGPT. If a quota runs out, say so in the card notes and go on.'
  return `${how} The target is at most ${target}% AI per document. Above that, rewrite it at most ONCE in my voice (style rules below), in natural full sentences, without changing a single fact; never break sentences into fragments to fool the detector. Then re-read the rewrite for style before saving it: it must still sound like me and read well (no stiff or odd wording, no filler, no broken rhythm, no lost specifics); fix such lines by hand, which is not a second rewrite. After that one rewrite, keep it and note the score in the card notes. Record every result with record_ai_check (detectors are unreliable, especially in German and French: report the numbers as they are).`
}

const STYLE_RULES = (p: SearchProfile) => `Style rules, so the letter sounds like me and not like a template:
- Open with something specific: the team, product or project from the posting, and why it matters to me given my studies or work. No "I am excited to apply", "passionate", "leverage", "dynamic team", "Hiermit bewerbe ich mich", "mit großem Interesse", "je me permets".
- Back every claim with a concrete fact from my CV or knowledge base (project, tool, result). Never invent anything.
- Vary sentence length, use plain words, first person, active voice. No em dashes (—) anywhere, also not in the CV or form answers, no triads of adjectives, no rhetorical questions, no summary sentence at the end of each paragraph.
- 220–320 words, one page.${searchesGermany(p) ? ' Do not overstate my German.' : ''}
- For the CV in non-strict mode, rephrase bullets only within their own facts.`

const PREPARE = (ctx: PromptContext) => `a. Tailored CV, one per company department: recruiters of a department see all my applications there, so they must get the same CV. If check_jobs shows cv_at_company (same company, same or unknown department), do not tailor a new CV: create the card with save_application (stage "draft", resume_id of that CV, the card fields) and go on with the letter. Otherwise: get_tailoring_material (once per session), write the CV yourself following its rules (the common CV rules plus my own rules for CVs and letters), then save_tailored_cv with the job and the card fields (new cards go to "Draft"); fix the fact-check notes. Layout rule: exactly one page, completely filled: every section whole, no empty space at the bottom of the page or under a column. Too long: hide the least relevant bullets, projects or skill groups (edit_cv) and keep everything the posting asks for. Spacing, font size and column width: never by hand, run fit_cv_to_page, which sets them for the fullest single page. Still too short after it, or a column that ends early: add a relevant bullet or project, or move a section to the other column, then fit_cv_to_page again. A tailored CV is ready only when its layout says "ok": true; only the master CV may have two pages. If the "layout" in the answer lists problems, fix them with edit_cv until "ok" is true. A second CV at the same company only for a clearly different department (card.department and separate_cv: true).
b. Languages: ${languageRule(ctx.profile)} Translate the CV yourself with get_cv + save_cv_translation (a reused CV may already have the language).
c. Motivation letter, always a new one for each job, also at the same company: get_letter_rules, write it yourself, save_motivation_letter for each language. Fix every warning. Each letter fits on one page: when the "layout" in the answer is not ok, shorten it and save it again.
d. AI check: ${detectorRule(ctx)}
e. Contact: look for the recruiter or HR person named in the posting, then on the company's careers or jobs page. Record the name, role and e-mail only if they are published there (never guess an address from a name pattern) and note where you found them.
f. Complete the card (card fields of save_tailored_cv, or save_application): url = the posting, apply_url = the direct application link on the company site or ATS when it differs, source, location, department, employment (type and hours), work_mode, german (the requirement as stated), deadline, posted_on (date first published), salary if stated, fit_score and a 2–3 sentence fit_summary (strengths and gaps), next_step "Review and apply".
g. Application form, for every job: follow the Apply / Bewerben button to the real form (company or ATS page, not LinkedIn Easy Apply) and save it as apply_url (mailto: for e-mail applications). LinkedIn hides the company link from signed-out readers: read_application_form with the LinkedIn link follows the same job on the Arbeitsagentur board when it can; otherwise find the posting on the company's careers page, or click Apply in the browser where I am signed in to LinkedIn. read_application_form(apply_url) lists the fields of any public form; if it cannot (account needed, bot check), open the form in the browser and read them. Then save_form_answers with an answer for each question, so I can copy them into the form. Only facts from my CV, knowledge base and search profile; for questions only I can answer (salary, start date, citizenship, gender), leave a note saying what to decide.
h. Last, check_draft on the card: it renders the CV in every language and every letter like their PDFs. The draft is done only when it says "ready": true (each CV exactly one page, completely filled, no empty space at the bottom or under a column; each letter one page). Fix what it lists and run it again.`

export const CLAUDE_PROMPTS: ClaudePrompt[] = [
  {
    name: 'job_hunt',
    title: 'Find jobs and prepare drafts',
    description: 'Searches the job boards, picks the best matches for my profile and leaves a tailored CV and motivation letter for each in "Draft". Never applies.',
    args: [
      {
        name: 'focus',
        description: 'optional focus for this run, e.g. "data engineering only" or "Berlin and Hamburg"',
        required: false,
        placeholder: 'Focus (optional), e.g. data engineering only',
      },
      { name: 'count', description: 'how many drafts to prepare (default from the profile)', required: false, placeholder: 'Number of drafts (optional)' },
      {
        name: 'by_email',
        description: 'how many of the drafts should be jobs I can apply to by e-mail',
        required: false,
        placeholder: 'How many by e-mail (optional), e.g. 3',
      },
    ],
    build: (ctx, args) => {
      const p = ctx.profile
      const count = Number(args.count) > 0 ? Math.min(25, Number(args.count)) : p.perRun
      const byEmail = Math.min(count, Math.max(0, Math.floor(Number(args.by_email) || 0)))
      return lines(
        `Run my job search with the Sforza tools and leave the results as drafts on my applications board. Do not apply anywhere.`,
        '',
        wishes(p, args.focus?.trim()),
        '',
        marketRules(ctx.profile),
        '',
        'Steps:',
        '1. Call get_profile (my CV, knowledge base, search profile and board). If it returns cv_setup_needed, build my master CV with me first; if it returns setup_needed, ask me those questions first and save my answers with save_search_profile; do not search before that.',
        p.sites.trim()
          ? `2. Search these sources first, in this order (my best ones), with several keyword variants for my roles${searchesGermany(p) ? ' in German and English' : ''}; then follow anything relevant they lead to, such as company career pages. Only postings first published in the last 7 days (strict: check the posting date, skip older ones and reposts of old ads) that are still open.\n${p.sites
              .trim()
              .split('\n')
              .filter((l) => l.trim())
              .map((l) => `   - ${l.trim()}`)
              .join('\n')}`
          : `2. Search broadly: ${defaultSources(p)}. Only postings first published in the last 7 days (strict: check the posting date, skip older ones and reposts of old ads) that are still open.`,
        '3. Call check_jobs with the candidates (with company and department) and drop the ones already on my board. Note cv_at_company for the others.',
        `4. Read each remaining posting in full (read_job_posting, or the text in the browser when the site blocks it) and judge the fit honestly: language requirement, degree and semester status, experience asked for, location and commute, job type, work-permit limits. Score the fit 0–100 and skip anything below ${p.minFit} or outside my language rule. Keep the skipped ones with the reason.`,
        `5. Take the best ${count} and prepare each one, saving each card as soon as it is ready (if this chat gets long, stop after a finished card and tell me how many are left):`,
        PREPARE(ctx),
        byEmail
          ? `   E-mail applications: at least ${byEmail} of the ${count} must be jobs I can apply to by e-mail, meaning the posting or the company's careers page publishes an application or contact address ("Bewerbung per E-Mail"; often smaller companies, institutes and university chairs). Look for them on purpose. For these, put the address in contact_email, set next_step "Send by e-mail", and add a short application e-mail to the card notes: subject line and 4–6 sentences in the posting's language, saying the CV and letter are attached. Do not send it.`
          : false,
        '6. Never submit an application, fill in an application form or send an e-mail. Everything stays in "Draft" for me to review.',
        '   A card is finished only when it has the CV, a letter in each needed language and at least one recorded AI check per letter, and check_draft says it is ready (one full page per CV, one page per letter); if a check was impossible, the card notes say why.',
        '7. Finish with a table (company, role, location, language required, fit, AI % for CV and letter, card link), then the skipped jobs with one-line reasons.',
        '',
        STYLE_RULES(ctx.profile),
      )
    },
  },
  {
    name: 'draft_application',
    title: 'Draft one application',
    description: 'Prepares the tailored CV, motivation letter, AI check and a complete "Draft" card for one job link. Never applies.',
    args: [{ name: 'url', description: 'link to the job posting', required: true, placeholder: 'Job link' }],
    build: (ctx, args) =>
      lines(
        `Prepare a complete draft application for this job, without applying: ${args.url?.trim() || '<paste the job link>'}`,
        '',
        wishes(ctx.profile),
        '',
        marketRules(ctx.profile),
        '',
        'Steps:',
        '1. get_profile, then read the posting (read_job_posting; if the site blocks it, use the text in the browser). For a LinkedIn link, its apply_on and same_job_elsewhere tell you where the real application form is.',
        '2. check_jobs: if the job is already on my board, update that card instead of creating a new one.',
        '3. Tell me the fit (0–100) with the main strengths and gaps, and the language requirement against my languages. If it breaks a hard requirement of my profile, stop and ask me before going on.',
        '4. Prepare it:',
        PREPARE(ctx),
        '5. When check_draft says ready, show me the card link, the PDF links (get_download_links) and the AI scores. Do not apply.',
        '',
        STYLE_RULES(ctx.profile),
      ),
  },
  {
    name: 'review_drafts',
    title: 'Review my drafts',
    description: 'Checks every "Draft" card for missing pieces, closed postings and deadlines, fixes what it can and tells me what to send first.',
    args: [],
    build: (ctx) =>
      lines(
        'Go through the cards in "Draft" on my applications board (list_applications with stage "draft", then get_application for each):',
        `- Missing pieces: CV or letter in a needed language (${languageRule(ctx.profile)}), apply link, contact, deadline, AI checks above ${ctx.profile.maxAiPercent}% or none at all.`,
        '- Layout: check_draft on each card (one full page per CV with no empty space at the bottom or under a column, one page per letter); fix what it lists until it says ready.',
        '- Postings that are closed or past their deadline (open the link): move them to "rejected" with the note "Posting closed".',
        `- Fix what you can with the same rules as the job search. AI check: ${detectorRule(ctx)}`,
        '- Then give me a short list ordered by deadline and fit: what to send first, with the card links and PDF links (get_download_links).',
        'Do not apply anywhere.',
        '',
        STYLE_RULES(ctx.profile),
      ),
  },
  {
    name: 'follow_up',
    title: 'Plan follow-ups and interviews',
    description: 'Drafts follow-up e-mails for applications without an answer and interview prep for upcoming interviews, in the card notes. Sends nothing.',
    args: [],
    build: () =>
      lines(
        'Look at my "Applied" and "Interview" cards (list_applications, get_application).',
        '- Applications sent more than 10 days ago with no update: draft a short, polite follow-up e-mail in the language of the application to the published contact (or the HR address on the card). Add it to the card notes (keep the existing notes) and set the next step "Follow up" with today\'s date.',
        '- Interviews: prepare the 6 most likely questions for that posting with short answers based only on my CV and knowledge base, plus 3 questions I can ask them. Add them to the card notes.',
        'Do not send anything. End with a list of what you prepared, by card.',
      ),
  },
  {
    name: 'build_knowledge_base',
    title: 'Add my projects and knowledge',
    description: 'Reads my GitHub and asks me questions to fill the knowledge base the CV writer picks from.',
    args: [],
    build: (ctx) =>
      lines(
        'Help me complete my knowledge base: the library of projects, skills, experience, certificates and notes that the CV and letter writer picks from.',
        '1. get_profile to see what is already there.',
        `2. Read ${ctx.github ? `my GitHub (${ctx.github})` : 'my GitHub'} and any links I give you. For each real project, add a project entry with update_library: name, a one-line subtitle (tech stack), the link, dates if known, and 1–3 factual bullets (what it does, what I built; numbers only if they are stated somewhere). Skip forks and empty repos. Update entries that already exist instead of duplicating them.`,
        '3. Then ask me, one topic at a time: my university courses and projects this semester, tools I have used that are not on my CV, achievements with numbers at each job, certificates, languages, volunteering. Add my answers as items or with notes_append.',
        '4. Ask me for my job-search wishes if the search profile is incomplete (roles, places, hours, start date, work permit) and save them with save_search_profile.',
        'Never invent facts. When something is unclear, ask me.',
      ),
  },
]
