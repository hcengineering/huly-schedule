import type { APIRoute, APIContext } from 'astro'
import log from 'loglevel'
import calendar, { type Calendar } from '@hcengineering/calendar'
import type { RescheduleRequest } from '../../scripts/types'
import { apiCallTx } from '../../scripts/server/api'
import {
  getEventAndGuest,
  getScheduleAndHost,
  makeIcal,
  prepareEmailTemplateParams,
  sendEmail
} from '../../scripts/server/utils'
import { getTimezoneOffset, isSlotBusy, loadEvents } from './timeslots'
import type { Ref } from '@hcengineering/core'

export const PUT: APIRoute = async ({ locals, request }: APIContext) => {
  const req: RescheduleRequest = await request.json()
  log.info('RESCHEDULE', req)

  const { workspaceUrl } = req
  const now = new Date()

  const res = await apiCallTx({ workspaceUrl }, async (client) => {
    const { schedule, hostPerson, hostSocialId } = await getScheduleAndHost(client, req.scheduleId)
    const { event, guestPerson, participants } = await getEventAndGuest(
      client,
      req.calendarId,
      req.eventId,
      req.guestEmail
    )

    const slotStart = req.timeslot.start
    const slotEnd = req.timeslot.end
    const events = await loadEvents(client, req.calendarIds, slotStart, slotEnd, req.personId)
    let tzOffset = getTimezoneOffset(new Date(slotStart), schedule.timeZone)
    if (isSlotBusy(events, slotStart, slotEnd, tzOffset)) {
      throw { status: 409, message: 'Slot is already busy' }
    }

    await client.updateDoc(
      calendar.class.Event,
      calendar.space.Calendar,
      event._id,
      {
        date: slotStart,
        dueDate: slotEnd
      },
      false,
      now.getTime(),
      hostSocialId._id
    )

    const updatedEvent = await client.findOne(calendar.class.Event, {
      _id: event._id,
      calendar: req.calendarId as Ref<Calendar>
    })
    log.debug('UPDATED_EVENT', updatedEvent)
    if (updatedEvent === undefined) {
      throw { status: 500, message: 'Updated event not retrieved' }
    }

    const ical = makeIcal(schedule, updatedEvent, guestPerson, participants)

    for (const p of participants) {
      const isGuest = p.person._id === guestPerson._id
      const templateParams = prepareEmailTemplateParams(
        isGuest ? req : {},
        'Meeting rescheduled',
        schedule,
        updatedEvent,
        hostPerson,
        hostSocialId.value,
        guestPerson,
        req.guestEmail
      )
      // For testing with real calendar providers:
      const overrideTo = isGuest ? process.env.OVERRIDE_GUEST_EMAIL : process.env.OVERRIDE_HOST_EMAIL
      await sendEmail(overrideTo ?? p.email, templateParams, ical)
    }

    return { ical }
  })
  if (!res.ok) {
    log.error('Error while rescheduling meeting', req, res)
    return new Response(JSON.stringify({ error: res.status }), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  const { ical } = res.data

  return new Response(ical, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="invite.ics"'
    }
  })
}
