/**
 * Mail the server can send itself: only when the Worker has a `send_email` binding named EMAIL (Cloudflare Email
 * Service) and MAIL_FROM, an address on a domain set up for sending there. Without them the admin's own mail app
 * sends the invitation (the app opens a written email), so nothing here is required.
 */

type MailEnv = { EMAIL?: SendEmail; MAIL_FROM?: string }

export const canSendMail = (env: object): boolean => {
  const e = env as MailEnv
  return !!e.EMAIL && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e.MAIL_FROM?.trim() ?? '')
}

/** Sends one plain email; false when mail is not set up or the service refused it. */
export async function sendMail(env: object, mail: { to: string; subject: string; text: string; replyTo?: string }): Promise<boolean> {
  const e = env as MailEnv
  if (!canSendMail(env)) return false
  try {
    await e.EMAIL!.send({
      from: { email: e.MAIL_FROM!.trim(), name: 'Sforza' },
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      ...(mail.replyTo && { replyTo: mail.replyTo }),
    })
    return true
  } catch (err) {
    console.error('Mail not sent', err instanceof Error ? err.message : err)
    return false
  }
}

/** The invitation email, written for the person who asked for access. */
export function invitationMail(input: { name: string; url: string; expiresAt: number; from: string }): { subject: string; text: string } {
  const until = new Date(input.expiresAt * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })
  const hello = input.name ? `Hi ${input.name},` : 'Hi,'
  return {
    subject: 'Your invitation to Sforza',
    text: [
      hello,
      '',
      'You asked for access to Sforza, the CV and job application builder. Here is your invitation:',
      '',
      input.url,
      '',
      `Open it to pick your username and password. The link works once, until ${until}.`,
      '',
      'When you are in, a short tour shows you around. Start with your knowledge base: the more it holds, the better every tailored CV and letter fits the job.',
      '',
      input.from,
    ].join('\n'),
  }
}
