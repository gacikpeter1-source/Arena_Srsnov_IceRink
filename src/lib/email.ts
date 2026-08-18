import { addDoc, collection } from 'firebase/firestore'
import { db } from './firebase'
import i18n, { SupportedLanguage } from '@/i18n'
import { generateQrDataUrl } from './qrcode'
import { buildGoogleCalendarUrl, buildIcsContent, IcsEventInput } from './ics'
import { PENDING_CONFIRMATION_MINUTES } from './bookings'
import { TRAINING_PENDING_CONFIRMATION_MINUTES } from './training'
import { Club, Zone } from '@/types'

interface MailAttachment {
  filename: string
  content: string
  contentType: string
}

/**
 * Queues an email by writing to the `mail` collection. Delivery is handled
 * by the sendQueuedMail Cloud Function (functions/src/index.ts) — a
 * self-hosted stand-in for the Firebase "Trigger Email from Firestore"
 * extension, which hit a Google Deployment Manager bug on install for this
 * project. Same document shape either would expect, so this queueing side
 * never had to change. Failures are swallowed: email is a notification,
 * not a booking precondition.
 */
async function queueEmail(to: string, subject: string, html: string, attachments?: MailAttachment[]): Promise<void> {
  try {
    await addDoc(collection(db, 'mail'), { to, message: { subject, html }, ...(attachments ? { attachments } : {}) })
  } catch (err) {
    console.warn('Could not queue email:', err)
  }
}

function icsAttachment(filename: string, events: IcsEventInput[]): MailAttachment {
  return { filename, content: buildIcsContent(events), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }
}

function calendarLinkButton(label: string, url: string): string {
  return `
    <div style="margin-top: 15px;">
      <a href="${url}" style="display: inline-block; padding: 10px 24px; background: #1a1a1a; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px;">
        ${label}
      </a>
    </div>
  `
}

function emailShell(club: Club, title: string, bodyHtml: string, footer: string): string {
  const primary = club.colors?.primary ?? '#FDB913'
  return `
    <!DOCTYPE html>
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: #1a1a1a; color: ${primary}; padding: 20px; text-align: center;">
            <h1 style="margin: 0;">${club.name}</h1>
            <h2 style="margin: 8px 0 0;">${title}</h2>
          </div>
          <div style="background: #f9f9f9; padding: 20px;">
            ${bodyHtml}
          </div>
          <div style="text-align: center; margin-top: 20px; color: #666; font-size: 12px;">
            <p>${footer}</p>
          </div>
        </div>
      </body>
    </html>
  `
}

function infoRow(label: string, value: string, borderColor = '#FDB913'): string {
  return `
    <div style="margin: 10px 0; padding: 10px; background: white; border-left: 4px solid ${borderColor};">
      <span style="font-weight: bold; color: #666;">${label}:</span>
      <span style="color: #000;"> ${value}</span>
    </div>
  `
}

interface BookingEmailInfo {
  bookingId: string
  cancellationToken: string
  confirmationCode: string
  date: string
  startTime: string
  durationMinutes: number
  name: string
  email: string
}

/**
 * Sent immediately for a booking created with requiresConfirmation (see
 * lib/bookings.ts) — the customer must click the link within
 * PENDING_CONFIRMATION_MINUTES or the slot is released. Deliberately
 * carries none of the calendar/QR/cancel content queueBookingConfirmationEmail
 * has — the booking isn't real yet, so there's nothing to add to a calendar
 * or cancel. That email is queued separately, from ConfirmBookingPage, only
 * once the click actually lands.
 */
export async function queuePendingConfirmationEmail(
  club: Club,
  zone: Zone,
  booking: Pick<BookingEmailInfo, 'bookingId' | 'cancellationToken' | 'name' | 'email' | 'date' | 'startTime' | 'durationMinutes'>,
  confirmBaseUrl: string,
  lang: SupportedLanguage
): Promise<void> {
  const t = i18n.getFixedT(lang)
  const confirmUrl = `${confirmBaseUrl}/confirm-booking/${booking.bookingId}/${booking.cancellationToken}`

  const body = `
    <p>${t('email.greeting', { name: booking.name })}</p>
    <p>${t('email.confirmPendingIntro', { count: PENDING_CONFIRMATION_MINUTES })}</p>
    ${infoRow(t('email.zone'), zone.name)}
    ${infoRow(t('email.date'), booking.date)}
    ${infoRow(t('email.time'), booking.startTime)}
    ${infoRow(t('email.duration'), t('common.minutes', { count: booking.durationMinutes }))}
    <div style="margin-top: 20px; text-align: center;">
      <a href="${confirmUrl}" style="display: inline-block; padding: 12px 30px; background: #16a34a; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
        ${t('email.confirmBookingButton')}
      </a>
      <p style="margin: 15px 0 0; font-size: 12px; color: #999;">${t('email.confirmPendingExpiry', { count: PENDING_CONFIRMATION_MINUTES })}</p>
    </div>
  `
  await queueEmail(
    booking.email,
    t('email.confirmPendingSubject', { club: club.name }),
    emailShell(club, t('email.confirmPendingTitle'), body, t('email.footer', { club: club.name }))
  )
}

/**
 * Emails are sent in the language the customer was using when they made or
 * cancelled the booking (`lang`), independent of whatever language the app
 * happens to be displaying in right now — i18next's getFixedT resolves
 * strings for a specific language without touching the live UI language.
 */
export async function queueBookingConfirmationEmail(
  club: Club,
  zone: Zone,
  booking: BookingEmailInfo,
  cancelBaseUrl: string,
  lang: SupportedLanguage
): Promise<void> {
  const t = i18n.getFixedT(lang)
  const cancelUrl = `${cancelBaseUrl}/my-booking/${booking.bookingId}/${booking.cancellationToken}`
  // Best-effort: if QR generation fails for any reason, the email still
  // sends fine without it — the text link above still works.
  const qrDataUrl = await generateQrDataUrl(cancelUrl).catch(() => null)

  const icsEvent: IcsEventInput = {
    uid: `${booking.bookingId}@${new URL(cancelBaseUrl).hostname}`,
    title: t('calendar.eventTitle', { club: club.name, zone: zone.name }),
    description: t('calendar.eventDescription', { code: booking.confirmationCode, url: cancelUrl }),
    location: club.contact.address || club.name,
    date: booking.date,
    startTime: booking.startTime,
    durationMinutes: booking.durationMinutes,
    timezone: club.timezone
  }

  const body = `
    <p>${t('email.greeting', { name: booking.name })}</p>
    <p>${t('email.confirmedIntro')}</p>
    ${infoRow(t('email.zone'), zone.name)}
    ${infoRow(t('email.date'), booking.date)}
    ${infoRow(t('email.time'), booking.startTime)}
    ${infoRow(t('email.duration'), t('common.minutes', { count: booking.durationMinutes }))}
    ${infoRow(t('email.confirmationCode'), booking.confirmationCode)}
    ${calendarLinkButton(t('calendar.addToGoogle'), buildGoogleCalendarUrl(icsEvent))}
    <div style="margin-top: 20px; padding: 15px; background: white; border: 2px solid #e5e7eb; border-radius: 8px; text-align: center;">
      <p style="margin: 0 0 15px; font-size: 14px; color: #666;">${t('email.needToCancel')}</p>
      <a href="${cancelUrl}" style="display: inline-block; padding: 12px 30px; background: #dc2626; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
        ${t('email.cancelBooking')}
      </a>
      ${qrDataUrl ? `<div style="margin-top: 15px;"><img src="${qrDataUrl}" alt="QR" width="140" height="140" style="background: white; padding: 8px; border-radius: 8px;" /></div>` : ''}
      <p style="margin: 15px 0 0; font-size: 12px; color: #999;">${t('email.linkExpires')}</p>
    </div>
  `
  await queueEmail(
    booking.email,
    t('email.bookingConfirmedSubject', { club: club.name }),
    emailShell(club, t('email.bookingConfirmedTitle'), body, t('email.footer', { club: club.name })),
    [icsAttachment(`${club.name}-booking.ics`, [icsEvent])]
  )
}

interface SeriesEmailInfo {
  seriesId: string
  cancellationToken: string
  startTime: string
  durationMinutes: number
  name: string
  email: string
  created: { bookingId: string; date: string; confirmationCode: string }[]
  skippedDates: string[]
}

/**
 * Sent once per recurring series (not once per occurrence, which would
 * spam a customer booking e.g. 10 weeks at once). Lists every date that
 * was actually booked (with its own confirmation code, in case they want
 * to cancel just that one date via the normal lookup flow) plus any dates
 * skipped because someone else already had that slot, and a single link
 * to cancel the whole remaining series (SeriesCancelPage).
 */
export async function queueSeriesConfirmationEmail(
  club: Club,
  zone: Zone,
  series: SeriesEmailInfo,
  cancelBaseUrl: string,
  lang: SupportedLanguage
): Promise<void> {
  const t = i18n.getFixedT(lang)
  const manageUrl = `${cancelBaseUrl}/my-series/${series.seriesId}/${series.cancellationToken}`
  const qrDataUrl = await generateQrDataUrl(manageUrl).catch(() => null)
  const hostname = new URL(cancelBaseUrl).hostname

  const icsEvents: IcsEventInput[] = series.created.map((o) => ({
    uid: `${o.bookingId}@${hostname}`,
    title: t('calendar.eventTitle', { club: club.name, zone: zone.name }),
    description: t('calendar.eventDescription', { code: o.confirmationCode, url: manageUrl }),
    location: club.contact.address || club.name,
    date: o.date,
    startTime: series.startTime,
    durationMinutes: series.durationMinutes,
    timezone: club.timezone
  }))

  const datesList = series.created
    .map((o) => `<li>${o.date} — <span style="font-family: monospace;">${o.confirmationCode}</span></li>`)
    .join('')
  const skippedBlock =
    series.skippedDates.length > 0
      ? `<p style="margin-top: 16px;">${t('email.seriesSkippedIntro')}</p>
         <ul>${series.skippedDates.map((d) => `<li>${d}</li>`).join('')}</ul>`
      : ''

  const body = `
    <p>${t('email.greeting', { name: series.name })}</p>
    <p>${t('email.seriesConfirmedIntro', { count: series.created.length })}</p>
    ${infoRow(t('email.zone'), zone.name)}
    ${infoRow(t('email.time'), series.startTime)}
    ${infoRow(t('email.duration'), t('common.minutes', { count: series.durationMinutes }))}
    <div style="margin: 16px 0; padding: 10px; background: white; border-left: 4px solid #FDB913;">
      <p style="font-weight: bold; color: #666; margin: 0 0 8px;">${t('email.seriesDatesLabel')}</p>
      <ul style="margin: 0; padding-left: 20px;">${datesList}</ul>
    </div>
    ${skippedBlock}
    <div style="margin-top: 20px; padding: 15px; background: white; border: 2px solid #e5e7eb; border-radius: 8px; text-align: center;">
      <p style="margin: 0 0 15px; font-size: 14px; color: #666;">${t('email.needToCancel')}</p>
      <a href="${manageUrl}" style="display: inline-block; padding: 12px 30px; background: #dc2626; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
        ${t('email.manageSeries')}
      </a>
      ${qrDataUrl ? `<div style="margin-top: 15px;"><img src="${qrDataUrl}" alt="QR" width="140" height="140" style="background: white; padding: 8px; border-radius: 8px;" /></div>` : ''}
      <p style="margin: 15px 0 0; font-size: 12px; color: #999;">${t('email.linkExpires')}</p>
    </div>
  `
  await queueEmail(
    series.email,
    t('email.seriesConfirmedSubject', { club: club.name }),
    emailShell(club, t('email.seriesConfirmedTitle'), body, t('email.footer', { club: club.name })),
    [icsAttachment(`${club.name}-sessions.ics`, icsEvents)]
  )
}

interface SeriesCancellationInfo {
  name: string
  email: string
  startTime: string
  durationMinutes: number
  cancelledCount: number
}

/**
 * Sent once when a customer/staff cancels a whole series via
 * SeriesCancelPage's "cancel entire series" button — not once per
 * occurrence, which would spam. Cancelling a single occurrence from that
 * same page instead reuses the normal queueCancellationEmail below.
 */
export async function queueSeriesCancellationEmail(
  club: Club,
  zone: Zone,
  info: SeriesCancellationInfo,
  lang: SupportedLanguage
): Promise<void> {
  const t = i18n.getFixedT(lang)
  const body = `
    <p>${t('email.greeting', { name: info.name })}</p>
    <p>${t('email.seriesCancelledIntro', { count: info.cancelledCount })}</p>
    ${infoRow(t('email.zone'), zone.name, '#dc2626')}
    ${infoRow(t('email.time'), info.startTime, '#dc2626')}
    ${infoRow(t('email.duration'), t('common.minutes', { count: info.durationMinutes }), '#dc2626')}
    <p style="margin-top: 20px;">${t('email.rebookNotice')}</p>
  `
  await queueEmail(
    info.email,
    t('email.seriesCancelledSubject', { club: club.name }),
    emailShell(club, t('email.seriesCancelledTitle'), body, t('email.footer', { club: club.name }))
  )
}

export async function queueCancellationEmail(
  club: Club,
  zone: Zone,
  booking: Pick<BookingEmailInfo, 'name' | 'email' | 'date' | 'startTime' | 'durationMinutes' | 'confirmationCode'>,
  lang: SupportedLanguage
): Promise<void> {
  const t = i18n.getFixedT(lang)
  const body = `
    <p>${t('email.greeting', { name: booking.name })}</p>
    <p>${t('email.cancelledIntro')}</p>
    ${infoRow(t('email.zone'), zone.name, '#dc2626')}
    ${infoRow(t('email.date'), booking.date, '#dc2626')}
    ${infoRow(t('email.time'), booking.startTime, '#dc2626')}
    ${infoRow(t('email.confirmationCode'), booking.confirmationCode, '#dc2626')}
    <p style="margin-top: 20px;">${t('email.rebookNotice')}</p>
  `
  await queueEmail(
    booking.email,
    t('email.bookingCancelledSubject', { club: club.name }),
    emailShell(club, t('email.bookingCancelledTitle'), body, t('email.footer', { club: club.name }))
  )
}

// ---------------------------------------------------------------------
// Training reservations (korčuľovanie) — session and bundle registration
// emails. Mirrors the booking emails above (same pending-confirm /
// confirmed / waitlist / cancelled shape) but keeps its own i18n
// namespace (`trainingEmail.*`) and functions, consistent with this
// domain being "redesigned from scratch, not shared" (see CLAUDE.md).
// ---------------------------------------------------------------------

interface TrainingRegEmailInfo {
  registrationId: string
  cancellationToken: string
  confirmationCode: string
  date: string
  startTime: string
  durationMinutes: number
  trainerName: string
  name: string
  email: string
}

export async function queueTrainingPendingConfirmationEmail(
  club: Club,
  reg: Pick<TrainingRegEmailInfo, 'registrationId' | 'cancellationToken' | 'name' | 'email' | 'date' | 'startTime' | 'durationMinutes' | 'trainerName'>,
  confirmBaseUrl: string,
  lang: SupportedLanguage
): Promise<void> {
  const t = i18n.getFixedT(lang)
  const confirmUrl = `${confirmBaseUrl}/treningy/potvrdit/${reg.registrationId}/${reg.cancellationToken}`

  const body = `
    <p>${t('email.greeting', { name: reg.name })}</p>
    <p>${t('trainingEmail.confirmPendingIntro', { count: TRAINING_PENDING_CONFIRMATION_MINUTES })}</p>
    ${infoRow(t('trainingEmail.trainer'), reg.trainerName)}
    ${infoRow(t('email.date'), reg.date)}
    ${infoRow(t('email.time'), reg.startTime)}
    ${infoRow(t('email.duration'), t('common.minutes', { count: reg.durationMinutes }))}
    <div style="margin-top: 20px; text-align: center;">
      <a href="${confirmUrl}" style="display: inline-block; padding: 12px 30px; background: #16a34a; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
        ${t('trainingEmail.confirmButton')}
      </a>
      <p style="margin: 15px 0 0; font-size: 12px; color: #999;">${t('email.confirmPendingExpiry', { count: TRAINING_PENDING_CONFIRMATION_MINUTES })}</p>
    </div>
  `
  await queueEmail(
    reg.email,
    t('trainingEmail.confirmPendingSubject', { club: club.name }),
    emailShell(club, t('trainingEmail.confirmPendingTitle'), body, t('email.footer', { club: club.name }))
  )
}

export async function queueTrainingConfirmationEmail(
  club: Club,
  reg: TrainingRegEmailInfo,
  cancelBaseUrl: string,
  lang: SupportedLanguage
): Promise<void> {
  const t = i18n.getFixedT(lang)
  const cancelUrl = `${cancelBaseUrl}/treningy/zrusit/${reg.registrationId}/${reg.cancellationToken}`
  const qrDataUrl = await generateQrDataUrl(cancelUrl).catch(() => null)

  const icsEvent: IcsEventInput = {
    uid: `${reg.registrationId}@${new URL(cancelBaseUrl).hostname}`,
    title: t('trainingCalendar.eventTitle', { club: club.name, trainer: reg.trainerName }),
    description: t('calendar.eventDescription', { code: reg.confirmationCode, url: cancelUrl }),
    location: club.contact.address || club.name,
    date: reg.date,
    startTime: reg.startTime,
    durationMinutes: reg.durationMinutes,
    timezone: club.timezone
  }

  const body = `
    <p>${t('email.greeting', { name: reg.name })}</p>
    <p>${t('trainingEmail.confirmedIntro')}</p>
    ${infoRow(t('trainingEmail.trainer'), reg.trainerName)}
    ${infoRow(t('email.date'), reg.date)}
    ${infoRow(t('email.time'), reg.startTime)}
    ${infoRow(t('email.duration'), t('common.minutes', { count: reg.durationMinutes }))}
    ${infoRow(t('email.confirmationCode'), reg.confirmationCode)}
    ${calendarLinkButton(t('calendar.addToGoogle'), buildGoogleCalendarUrl(icsEvent))}
    <div style="margin-top: 20px; padding: 15px; background: white; border: 2px solid #e5e7eb; border-radius: 8px; text-align: center;">
      <p style="margin: 0 0 15px; font-size: 14px; color: #666;">${t('email.needToCancel')}</p>
      <a href="${cancelUrl}" style="display: inline-block; padding: 12px 30px; background: #dc2626; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
        ${t('trainingEmail.cancelButton')}
      </a>
      ${qrDataUrl ? `<div style="margin-top: 15px;"><img src="${qrDataUrl}" alt="QR" width="140" height="140" style="background: white; padding: 8px; border-radius: 8px;" /></div>` : ''}
    </div>
  `
  await queueEmail(
    reg.email,
    t('trainingEmail.confirmedSubject', { club: club.name }),
    emailShell(club, t('trainingEmail.confirmedTitle'), body, t('email.footer', { club: club.name })),
    [icsAttachment(`${club.name}-training.ics`, [icsEvent])]
  )
}

export async function queueTrainingWaitlistEmail(
  club: Club,
  reg: Pick<TrainingRegEmailInfo, 'name' | 'email' | 'date' | 'startTime' | 'trainerName'>,
  lang: SupportedLanguage
): Promise<void> {
  const t = i18n.getFixedT(lang)
  const body = `
    <p>${t('email.greeting', { name: reg.name })}</p>
    <p>${t('trainingEmail.waitlistIntro')}</p>
    ${infoRow(t('trainingEmail.trainer'), reg.trainerName)}
    ${infoRow(t('email.date'), reg.date)}
    ${infoRow(t('email.time'), reg.startTime)}
  `
  await queueEmail(
    reg.email,
    t('trainingEmail.waitlistSubject', { club: club.name }),
    emailShell(club, t('trainingEmail.waitlistTitle'), body, t('email.footer', { club: club.name }))
  )
}

export async function queueTrainingCancellationEmail(
  club: Club,
  reg: Pick<TrainingRegEmailInfo, 'name' | 'email' | 'date' | 'startTime' | 'trainerName' | 'confirmationCode'>,
  lang: SupportedLanguage
): Promise<void> {
  const t = i18n.getFixedT(lang)
  const body = `
    <p>${t('email.greeting', { name: reg.name })}</p>
    <p>${t('trainingEmail.cancelledIntro')}</p>
    ${infoRow(t('trainingEmail.trainer'), reg.trainerName, '#dc2626')}
    ${infoRow(t('email.date'), reg.date, '#dc2626')}
    ${infoRow(t('email.time'), reg.startTime, '#dc2626')}
    ${infoRow(t('email.confirmationCode'), reg.confirmationCode, '#dc2626')}
  `
  await queueEmail(
    reg.email,
    t('trainingEmail.cancelledSubject', { club: club.name }),
    emailShell(club, t('trainingEmail.cancelledTitle'), body, t('email.footer', { club: club.name }))
  )
}

interface BundleRegEmailInfo {
  registrationId: string
  cancellationToken: string
  confirmationCode: string
  title: string
  trainerName: string
  name: string
  email: string
  sessions: { date: string; startTime: string; durationMinutes: number }[]
}

export async function queueBundlePendingConfirmationEmail(
  club: Club,
  reg: Pick<BundleRegEmailInfo, 'registrationId' | 'cancellationToken' | 'name' | 'email' | 'title' | 'trainerName'>,
  confirmBaseUrl: string,
  lang: SupportedLanguage
): Promise<void> {
  const t = i18n.getFixedT(lang)
  const confirmUrl = `${confirmBaseUrl}/treningy/kurz/potvrdit/${reg.registrationId}/${reg.cancellationToken}`

  const body = `
    <p>${t('email.greeting', { name: reg.name })}</p>
    <p>${t('trainingEmail.confirmPendingIntro', { count: TRAINING_PENDING_CONFIRMATION_MINUTES })}</p>
    ${infoRow(t('trainingEmail.bundleTitle'), reg.title)}
    ${infoRow(t('trainingEmail.trainer'), reg.trainerName)}
    <div style="margin-top: 20px; text-align: center;">
      <a href="${confirmUrl}" style="display: inline-block; padding: 12px 30px; background: #16a34a; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
        ${t('trainingEmail.confirmButton')}
      </a>
      <p style="margin: 15px 0 0; font-size: 12px; color: #999;">${t('email.confirmPendingExpiry', { count: TRAINING_PENDING_CONFIRMATION_MINUTES })}</p>
    </div>
  `
  await queueEmail(
    reg.email,
    t('trainingEmail.confirmPendingSubject', { club: club.name }),
    emailShell(club, t('trainingEmail.confirmPendingTitle'), body, t('email.footer', { club: club.name }))
  )
}

export async function queueBundleConfirmationEmail(
  club: Club,
  reg: BundleRegEmailInfo,
  cancelBaseUrl: string,
  lang: SupportedLanguage
): Promise<void> {
  const t = i18n.getFixedT(lang)
  const cancelUrl = `${cancelBaseUrl}/treningy/kurz/zrusit/${reg.registrationId}/${reg.cancellationToken}`
  const hostname = new URL(cancelBaseUrl).hostname

  const icsEvents: IcsEventInput[] = reg.sessions.map((s, i) => ({
    uid: `${reg.registrationId}-${i}@${hostname}`,
    title: t('trainingCalendar.eventTitle', { club: club.name, trainer: reg.trainerName }),
    description: t('calendar.eventDescription', { code: reg.confirmationCode, url: cancelUrl }),
    location: club.contact.address || club.name,
    date: s.date,
    startTime: s.startTime,
    durationMinutes: s.durationMinutes,
    timezone: club.timezone
  }))

  const datesList = reg.sessions.map((s) => `<li>${s.date} — ${s.startTime}</li>`).join('')

  const body = `
    <p>${t('email.greeting', { name: reg.name })}</p>
    <p>${t('trainingEmail.bundleConfirmedIntro', { count: reg.sessions.length })}</p>
    ${infoRow(t('trainingEmail.bundleTitle'), reg.title)}
    ${infoRow(t('trainingEmail.trainer'), reg.trainerName)}
    ${infoRow(t('email.confirmationCode'), reg.confirmationCode)}
    <div style="margin: 16px 0; padding: 10px; background: white; border-left: 4px solid #FDB913;">
      <p style="font-weight: bold; color: #666; margin: 0 0 8px;">${t('email.seriesDatesLabel')}</p>
      <ul style="margin: 0; padding-left: 20px;">${datesList}</ul>
    </div>
    <div style="margin-top: 20px; padding: 15px; background: white; border: 2px solid #e5e7eb; border-radius: 8px; text-align: center;">
      <p style="margin: 0 0 15px; font-size: 14px; color: #666;">${t('email.needToCancel')}</p>
      <a href="${cancelUrl}" style="display: inline-block; padding: 12px 30px; background: #dc2626; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
        ${t('trainingEmail.cancelButton')}
      </a>
    </div>
  `
  await queueEmail(
    reg.email,
    t('trainingEmail.bundleConfirmedSubject', { club: club.name }),
    emailShell(club, t('trainingEmail.bundleConfirmedTitle'), body, t('email.footer', { club: club.name })),
    [icsAttachment(`${club.name}-${reg.title}.ics`, icsEvents)]
  )
}

export async function queueBundleWaitlistEmail(
  club: Club,
  reg: Pick<BundleRegEmailInfo, 'name' | 'email' | 'title' | 'trainerName'>,
  lang: SupportedLanguage
): Promise<void> {
  const t = i18n.getFixedT(lang)
  const body = `
    <p>${t('email.greeting', { name: reg.name })}</p>
    <p>${t('trainingEmail.waitlistIntro')}</p>
    ${infoRow(t('trainingEmail.bundleTitle'), reg.title)}
    ${infoRow(t('trainingEmail.trainer'), reg.trainerName)}
  `
  await queueEmail(
    reg.email,
    t('trainingEmail.waitlistSubject', { club: club.name }),
    emailShell(club, t('trainingEmail.waitlistTitle'), body, t('email.footer', { club: club.name }))
  )
}

export async function queueBundleCancellationEmail(
  club: Club,
  reg: Pick<BundleRegEmailInfo, 'name' | 'email' | 'title' | 'trainerName' | 'confirmationCode'>,
  lang: SupportedLanguage
): Promise<void> {
  const t = i18n.getFixedT(lang)
  const body = `
    <p>${t('email.greeting', { name: reg.name })}</p>
    <p>${t('trainingEmail.cancelledIntro')}</p>
    ${infoRow(t('trainingEmail.bundleTitle'), reg.title, '#dc2626')}
    ${infoRow(t('trainingEmail.trainer'), reg.trainerName, '#dc2626')}
    ${infoRow(t('email.confirmationCode'), reg.confirmationCode, '#dc2626')}
  `
  await queueEmail(
    reg.email,
    t('trainingEmail.cancelledSubject', { club: club.name }),
    emailShell(club, t('trainingEmail.cancelledTitle'), body, t('email.footer', { club: club.name }))
  )
}
