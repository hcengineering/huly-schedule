import { type WorkspaceLoginInfo, getClient as getAccountClient } from '@hcengineering/account-client'
import calendar, { type Calendar, type Event, AccessLevel, generateEventId } from '@hcengineering/calendar'
import contact, { type SocialIdentityRef, AvatarType, combineName, formatName } from '@hcengineering/contact'
import core, {
  type Ref,
  type TxOperations,
  SocialIdType,
  buildSocialIdString,
  generateId
} from '@hcengineering/core'
import love from '@hcengineering/love'
import type { APIContext, APIRoute } from 'astro'
import log from 'loglevel'
import { apiCallTx, type ErrorResult } from '../../scripts/server/api'
import {
  getMeetingLinks,
  getScheduleAndHost,
  makeIcal,
  prepareEmailTemplateParams,
  sendEmail
} from '../../scripts/server/utils'
import type { BookingRequest } from '../../scripts/types'
import { getTimezoneOffset, isSlotBusy, loadEvents } from './timeslots'

export const PUT: APIRoute = async ({ locals, request }: APIContext) => {
  const req: BookingRequest = await request.json()
  log.info('BOOK', req)

  const { workspaceUrl, personUuid } = req
  const now = new Date()

  const res = await apiCallTx(
    { workspaceUrl },
    async (client: TxOperations, wsInfo: WorkspaceLoginInfo) => {
      const { schedule, hostPerson, hostSocialId } = await getScheduleAndHost(client, req.scheduleId)

      const slotStart = req.timeslot.start
      const slotEnd = req.timeslot.end
      const events = await loadEvents(client, req.calendarIds, slotStart, slotEnd, req.personId)
      let tzOffset = getTimezoneOffset(new Date(slotStart), schedule.timeZone)
      if (isSlotBusy(events, slotStart, slotEnd, tzOffset)) {
        throw { status: 409, message: 'Slot is already busy' }
      }

      const accountClient = getAccountClient(process.env.ACCOUNT_URL, wsInfo.token)

      const { uuid: guestPersonUuid, socialId: guestSocialId } = await accountClient.ensurePerson(
        SocialIdType.EMAIL,
        req.booking.email,
        req.booking.firstName,
        req.booking.lastName
      )
      log.debug('GUEST_PERSON_GLOBAL', guestPersonUuid, guestSocialId)

      let guestPerson = await client.findOne(contact.class.Person, { personUuid: guestPersonUuid })
      log.debug('GUEST_PERSON', guestPerson)
      if (guestPerson === undefined) {
        const guestPersonId = await client.createDoc(contact.class.Person, contact.space.Contacts, {
          avatarType: AvatarType.COLOR,
          name: combineName(req.booking.firstName, req.booking.lastName),
          personUuid: guestPersonUuid
        })
        guestPerson = await client.findOne(contact.class.Person, { _id: guestPersonId })
        log.debug('GUEST_PERSON_NEW', guestPerson)
        if (guestPerson === undefined) {
          throw { status: 500, message: 'Failed to create guest person' }
        }

        await client.addCollection(
          contact.class.SocialIdentity,
          contact.space.Contacts,
          guestPerson._id,
          contact.class.Person,
          'socialIds',
          {
            key: buildSocialIdString({ type: SocialIdType.EMAIL, value: req.booking.email }),
            type: SocialIdType.EMAIL,
            value: req.booking.email
          },
          guestSocialId as SocialIdentityRef
        )
      }

      const guestChannel = await client.findOne(contact.class.Channel, {
        attachedTo: guestPerson._id,
        attachedToClass: contact.class.Person,
        provider: contact.channelProvider.Email,
        value: req.booking.email
      })
      if (guestChannel === undefined) {
        await client.addCollection(
          contact.class.Channel,
          contact.space.Contacts,
          guestPerson._id,
          contact.class.Person,
          'channels',
          {
            provider: contact.channelProvider.Email,
            value: req.booking.email
          }
        )
      }

      let meetingRoomId = (schedule as any)['love:mixin:MeetingSchedule']?.room
      if (meetingRoomId == null) {
        const hostOffice = await client.findOne(
          love.class.Office,
          {
            person: hostPerson._id
          },
          {
            projection: { _id: 1 }
          }
        )
        log.debug('HOST_OFFICE', hostOffice)
        if (hostOffice === undefined) {
          throw { status: 404, message: 'Office not found for person ' + hostPerson._id }
        }
        meetingRoomId = hostOffice._id
      } else {
        log.debug('MEETING_ROOM_ID', meetingRoomId)
      }

      const eventId = generateEventId()
      const eventRef = generateId() as Ref<Event>

      const { meetingLink, guestLink } = await getMeetingLinks({
        workspaceUrl,
        personUuid,
        eventRef,
        guestName: guestPerson.name,
        guestEmail: req.booking.email,
        slotStart,
      })

      await client.addCollection<Event, Event>(
        calendar.class.Event,
        calendar.space.Calendar,
        calendar.ids.NoAttached,
        calendar.class.Event,
        'events',
        {
          calendar: req.calendarId as Ref<Calendar>,
          eventId,
          date: slotStart,
          dueDate: slotEnd,
          blockTime: true,
          title: `${schedule.title} (${formatName(guestPerson.name, process.env.LAST_NAME_FIRST)})`,
          description: req.booking.subject,
          location: meetingLink,
          visibility: 'public',
          participants: [hostPerson._id, guestPerson._id],
          allDay: false,
          timeZone: req.timeZone,
          access: AccessLevel.Owner,
          user: hostSocialId._id
        },
        eventRef,
        now.getTime(),
        core.account.System,
      )

      let event: Event | undefined
      const newEvents = await client.findAll(calendar.class.Event, {
        eventId
        // in all calendars
      })
      for (const e of newEvents) {
        if (e._id === eventRef) {
          event = e
        }
        await client.createMixin(
          e._id,
          calendar.class.Event,
          e.space,
          love.mixin.Meeting,
          {
            room: meetingRoomId
          },
          now.getTime(),
          core.account.System,
        )
      }
      if (event === undefined) {
        throw { status: 500, message: 'Failed to retrieve just created event' }
      }

      const participants = [
        {
          person: guestPerson,
          email: req.booking.email
        },
        {
          person: hostPerson,
          email: hostSocialId.value
        }
      ]

      const hostIcal = makeIcal(schedule, event, guestPerson, participants)
      const guestIcal = makeIcal(schedule, event, guestPerson, participants, { location: guestLink })

      for (const p of participants) {
        const isGuest = p.person._id === guestPerson._id
        const templateParams = prepareEmailTemplateParams(
          isGuest ? req : {},
          'Meeting booked',
          schedule,
          event,
          hostPerson,
          hostSocialId.value,
          guestPerson,
          req.booking.email,
          {
            linkJoin: isGuest ? guestLink : meetingLink
          }
        )
        // For testing with real calendar providers:
        const overrideTo = isGuest ? process.env.OVERRIDE_GUEST_EMAIL : process.env.OVERRIDE_HOST_EMAIL
        await sendEmail( overrideTo ?? p.email, templateParams, isGuest ? guestIcal : hostIcal)
      }

      return { eventId, ical: guestIcal }
    }
  )
  if (!res.ok) {
    log.error('Error while booking meeting', req, res)
    return new Response(JSON.stringify({ error: (res as ErrorResult).status }), {
      status: (res as ErrorResult).status,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify(res.data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  })
}
