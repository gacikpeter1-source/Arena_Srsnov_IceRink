import { addDoc, collection } from 'firebase/firestore'
import { db } from './firebase'
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

function emailShell(club: Club, title: string, bodyHtml: string): string {
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
            <p>This email was sent automatically by ${club.name}'s booking system.</p>
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

export async function queueBookingConfirmationEmail(
  club: Club,
  zone: Zone,
  booking: BookingEmailInfo,
  cancelBaseUrl: string
): Promise<void> {
  const cancelUrl = `${cancelBaseUrl}/my-booking/${booking.bookingId}/${booking.cancellationToken}`
  const body = `
    <p>Hi ${booking.name},</p>
    <p>Your booking is <strong>confirmed</strong>:</p>
    ${infoRow('Zone', zone.name)}
    ${infoRow('Date', booking.date)}
    ${infoRow('Time', booking.startTime)}
    ${infoRow('Duration', `${booking.durationMinutes} min`)}
    ${infoRow('Confirmation code', booking.confirmationCode)}
    <div style="margin-top: 20px; padding: 15px; background: white; border: 2px solid #e5e7eb; border-radius: 8px; text-align: center;">
      <p style="margin: 0 0 15px; font-size: 14px; color: #666;">Need to cancel?</p>
      <a href="${cancelUrl}" style="display: inline-block; padding: 12px 30px; background: #dc2626; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
        Cancel booking
      </a>
      <p style="margin: 15px 0 0; font-size: 12px; color: #999;">This link expires in 14 days.</p>
    </div>
  `
  await queueEmail(booking.email, `Booking confirmed — ${club.name}`, emailShell(club, 'Booking confirmed', body))
}

export async function queueCancellationEmail(
  club: Club,
  zone: Zone,
  booking: Pick<BookingEmailInfo, 'name' | 'email' | 'date' | 'startTime' | 'durationMinutes' | 'confirmationCode'>
): Promise<void> {
  const body = `
    <p>Hi ${booking.name},</p>
    <p>Your booking has been <strong>cancelled</strong>:</p>
    ${infoRow('Zone', zone.name, '#dc2626')}
    ${infoRow('Date', booking.date, '#dc2626')}
    ${infoRow('Time', booking.startTime, '#dc2626')}
    ${infoRow('Confirmation code', booking.confirmationCode, '#dc2626')}
    <p style="margin-top: 20px;">If this wasn't you, or you'd like to rebook, just visit the app again.</p>
  `
  await queueEmail(booking.email, `Booking cancelled — ${club.name}`, emailShell(club, 'Booking cancelled', body))
}
