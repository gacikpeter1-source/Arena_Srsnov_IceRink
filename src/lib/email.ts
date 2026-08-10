import { addDoc, collection } from 'firebase/firestore'
import { db } from './firebase'
import i18n, { SupportedLanguage } from '@/i18n'
import { generateQrDataUrl } from './qrcode'
import { Club, Zone } from '@/types'

/**
 * Queues an email by writing to the `mail` collection, which the Firebase
 * "Trigger Email from Firestore" extension watches and sends via SMTP —
 * same mechanism as the Arena-Srsnov reference app (see EMAIL_SETUP_GUIDE.md).
 * Failures are swallowed: email is a notification, not a booking precondition.
 */
async function queueEmail(to: string, subject: string, html: string): Promise<void> {
  try {
    await addDoc(collection(db, 'mail'), { to, message: { subject, html } })
  } catch (err) {
    console.warn('Could not queue email (Extension may not be installed):', err)
  }
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
  const body = `
    <p>${t('email.greeting', { name: booking.name })}</p>
    <p>${t('email.confirmedIntro')}</p>
    ${infoRow(t('email.zone'), zone.name)}
    ${infoRow(t('email.date'), booking.date)}
    ${infoRow(t('email.time'), booking.startTime)}
    ${infoRow(t('email.duration'), t('common.minutes', { count: booking.durationMinutes }))}
    ${infoRow(t('email.confirmationCode'), booking.confirmationCode)}
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
    emailShell(club, t('email.bookingConfirmedTitle'), body, t('email.footer', { club: club.name }))
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
