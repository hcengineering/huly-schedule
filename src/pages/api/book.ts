import type { APIRoute, APIContext } from 'astro'
import { type WorkspaceLoginInfo, getClient as getAccountClient } from '@hcengineering/account-client'
import calendar, { type Calendar, type Event, generateEventId } from '@hcengineering/calendar'
import {
  type Ref,
  type TxOperations,
  AccountRole,
  SocialIdType,
  buildSocialIdString,
  generateId
} from '@hcengineering/core'
import contact, { type SocialIdentityRef, AvatarType, combineName, formatName } from '@hcengineering/contact'
import love, { loveId } from '@hcengineering/love'
import type { BookingRequest } from '../../scripts/types'
import { apiCallTx } from '../../scripts/server/api'
import { loadEvents, isSlotBusy, getTimezoneOffset } from './timeslots'
import { getScheduleAndHost, makeIcal, prepareEmailTemplateParams, sendEmail } from '../../scripts/server/utils'

export const PUT: APIRoute = async ({ locals, request }: APIContext) => {
  const req: BookingRequest = await request.json()
  console.log('BOOK', req)

  const { workspaceUrl, personUuid } = req
  const now = new Date()

  const res = await apiCallTx(
    { workspaceUrl, personUuid },
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
      //console.log('GUEST_PERSON_GLOBAL', guestPersonUuid, guestSocialId)

      let guestPerson = await client.findOne(contact.class.Person, { personUuid: guestPersonUuid })
      //console.log('GUEST_PERSON', guestPerson)
      if (guestPerson === undefined) {
        const guestPersonId = await client.createDoc(contact.class.Person, contact.space.Contacts, {
          avatarType: AvatarType.COLOR,
          name: combineName(req.booking.firstName, req.booking.lastName),
          personUuid: guestPersonUuid
        })
        guestPerson = await client.findOne(contact.class.Person, { _id: guestPersonId })
        //console.log('GUEST_PERSON_NEW', guestPerson)
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

      const hostOffice = await client.findOne(
        love.class.Office,
        {
          person: hostPerson._id
        },
        {
          projection: { _id: 1 }
        }
      )
      //console.log('HOST_OFFICE', hostOffice)
      if (hostOffice === undefined) {
        throw { status: 404, message: 'Office not found for person ' + hostPerson._id }
      }

      const eventId = generateEventId()
      const eventObjectId = generateId() as Ref<Event>

      let inviteExpHours = parseFloat(process.env.INVITE_EXPIRATION_HOURS ?? '1')
      if (isNaN(inviteExpHours) || inviteExpHours < 0) {
        inviteExpHours = 1
      }

      const meetingLink = await accountClient.createInviteLink(
        req.booking.email,
        AccountRole.Guest,
        true,
        req.booking.firstName,
        req.booking.lastName,
        encodeURIComponent(
          JSON.stringify({
            path: ['workbench', wsInfo.workspaceUrl, loveId],
            query: { meetId: eventObjectId }
          })
        ),
        (slotStart - Date.now()) / 3_600_000 + inviteExpHours
      )
      //console.log('MEETING_LINK', meetingLink)

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
          title: `${schedule.title} (${formatName(guestPerson.name, process.env.LAST_NAME_FIRST)})`,
          description: req.booking.subject,
          location: meetingLink,
          visibility: 'public',
          participants: [hostPerson._id, guestPerson._id],
          allDay: false,
          timeZone: req.timeZone,
          access: 'owner',
          user: hostSocialId._id
        },
        eventObjectId,
        now.getTime(),
        // onEventCreate in service triggers checks if the event was not created by one of its participants
        // and adds another event for that who created the original event. So createdBy should be the host
        hostSocialId._id
      )

      let event: Event | undefined
      const newEvents = await client.findAll(calendar.class.Event, {
        eventId
        // in all calendars
      })
      for (const e of newEvents) {
        if (e._id === eventObjectId) {
          event = e
        }
        await client.createMixin(
          e._id,
          calendar.class.Event,
          e.space,
          love.mixin.Meeting,
          {
            room: hostOffice._id
          },
          now.getTime(),
          hostSocialId._id
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

      const ical = makeIcal(schedule, event, guestPerson, participants)

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
          req.booking.email
        )
        // For testing with real calendar providers:
        const overrideTo = isGuest ? process.env.OVERRIDE_GUEST_EMAIL : process.env.OVERRIDE_HOST_EMAIL
        await sendEmail( overrideTo ?? p.email, templateParams, ical)
      }

      return { eventId, ical }
    }
  )
  if (!res.ok) {
    console.log('Error while booking meeting', req, res)
    return new Response(JSON.stringify({ error: res.status }), {
      status: res.status,
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
