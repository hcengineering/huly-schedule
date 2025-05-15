import type { APIRoute, APIContext } from 'astro'
import log from 'loglevel'
import { type WorkspaceLoginInfo, getClient as getAccountClient } from '@hcengineering/account-client'
import calendar, { type Calendar } from '@hcengineering/calendar'
import type { RescheduleRequest } from '../../scripts/types'
import { apiCallTx } from '../../scripts/server/api'
import {
  getEventAndGuest,
  getMeetingLinks,
  getScheduleAndHost,
  makeIcal,
  prepareEmailTemplateParams,
  sendEmail
} from '../../scripts/server/utils'
import { getTimezoneOffset, isSlotBusy, loadEvents } from './timeslots'
import { type Ref, type TxOperations } from '@hcengineering/core'

export const PUT: APIRoute = async ({ request }: APIContext) => {
  const req: RescheduleRequest = await request.json()
  log.info('RESCHEDULE', req)

  const { workspaceUrl, personUuid } = req
  const now = new Date()

  const res = await apiCallTx(
    { workspaceUrl, personUuid },
    async (client: TxOperations, wsInfo: WorkspaceLoginInfo) => {
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

      const accountClient = getAccountClient(process.env.ACCOUNT_URL, wsInfo.token)

      const { meetingLink, guestLink } = await getMeetingLinks({
        accountClient,
        workspaceUrl: wsInfo.workspaceUrl,
        eventObjectId: event._id,
        guestName: guestPerson.name,
        guestEmail: req.guestEmail,
        slotStart,
      })

      await client.updateDoc(
        calendar.class.Event,
        calendar.space.Calendar,
        event._id,
        {
          date: slotStart,
          dueDate: slotEnd,
          location: meetingLink,
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

      const hostIcal = makeIcal(schedule, updatedEvent, guestPerson, participants)
      const guestIcal = makeIcal(schedule, event, guestPerson, participants, { location: guestLink })

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
          req.guestEmail,
          {
            linkJoin: isGuest ? guestLink : meetingLink,
          }
        )
        // For testing with real calendar providers:
        const overrideTo = isGuest ? process.env.OVERRIDE_GUEST_EMAIL : process.env.OVERRIDE_HOST_EMAIL
        await sendEmail(overrideTo ?? p.email, templateParams, isGuest ? guestIcal : hostIcal)
      }

      return { ical: guestIcal }
    }
  )
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
