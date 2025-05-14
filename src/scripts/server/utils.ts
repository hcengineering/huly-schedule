import ical, {
  type ICalAttendeeData,
  ICalAttendeeRole,
  ICalAttendeeStatus,
  ICalAttendeeType,
  ICalCalendarMethod,
  ICalEventClass,
  ICalEventStatus,
  ICalEventTransparency
} from 'ical-generator'
import log from 'loglevel'
import Mustache from 'mustache'
import type { AccountClient } from '@hcengineering/account-client'
import type { RestClient } from '@hcengineering/api-client'
import calendar, { type Calendar, type Event, type Schedule } from '@hcengineering/calendar'
import contact, {
  type Person,
  type SocialIdentity,
  formatName,
  getAvatarColorForId,
  getFirstName,
  getLastName
} from '@hcengineering/contact'
import { AccountRole, concatLink, SocialIdType, type Projection, type Ref, type TxOperations } from '@hcengineering/core'
import { loveId } from '@hcengineering/love'
import type { Timestamp, UIContext } from '../types'
import { apiCall } from './api'
import emailHtml from '../../emails/booked.html?raw'
import emailText from '../../emails/booked.txt?raw'

log.setLevel(process.env.LOG_LEVEL as any ?? 'info')

function getAvatarName(name: string | null | undefined): string {
  if (name == null) {
    return ''
  }
  const lastNameFirst = process.env.LAST_NAME_FIRST === 'true'
  const fname = getFirstName(name ?? '').trim()[0] ?? ''
  const lname = getLastName(name ?? '').trim()[0] ?? ''
  return lastNameFirst ? lname + fname : fname + lname
}

export async function makeContext(params: Record<string, string | undefined>): Promise<UIContext> {
  const workspaceUrl = params.workspace
  if (workspaceUrl === undefined) {
    log.error('Missing workspace', workspaceUrl)
    throw { status: 400 }
  }

  const scheduleId = params.schedule
  if (scheduleId === undefined) {
    log.error('Missing schedule', scheduleId)
    throw { status: 400 }
  }

  const res = await apiCall({ workspaceUrl }, async (client) => {
    const schedule = await client.findOne(
      calendar.class.Schedule,
      {
        _id: scheduleId as Ref<Schedule>
      },
      {
        projection: {
          owner: 1,
          title: 1,
          description: 1,
          meetingDuration: 1
        }
      }
    )
    log.debug('SCHEDULE', schedule)
    if (schedule === undefined) {
      throw { status: 404, message: 'Schedule not found for ' + scheduleId }
    }

    const person = await client.findOne(contact.class.Person, {
      _id: schedule.owner
    })
    log.debug('PERSON', person)
    if (person === undefined) {
      throw { status: 404, message: 'Person not found for ' + schedule.owner }
    }
    const avatarName = getAvatarName(person.name)
    const avatarColor = getAvatarColorForId(avatarName)

    const personSocialIdents = await client.findAll(
      contact.class.SocialIdentity,
      {
      attachedTo: person._id,
      attachedToClass: contact.class.Person
      },
      { projection: { _id: 1 } }
    )
    log.debug('PERSON_SOCIAL_IDENTS', personSocialIdents)

    const personSocialIds = personSocialIdents.map((si) => si._id)
    log.debug('PERSON_SOCIAL_IDS', personSocialIds)

    const calendars = await client.findAll(
      calendar.class.Calendar,
      {
        createdBy: { $in: personSocialIds },
        hidden: false
      },
      {
        projection: { _id: 1 }
      }
    )
    log.debug('ALL_CALENDARS', calendars)
    if (calendars.length === 0) {
      throw { status: 404, message: 'Calendars not found for ' + person.personUuid }
    }

    const calendr = calendars.find((c) => c._id === (`${person.personUuid}_calendar` as Ref<Calendar>))
    log.debug('PERSON_CALENDAR', calendr)
    if (calendr === undefined) {
      throw { status: 404, message: 'Calendar not found for ' + person.personUuid }
    }

    let editingEvent: Event | undefined
    let guestEmail: string | undefined
    if (params.event !== undefined && params.email !== undefined) {
      guestEmail = decodeURIComponent(params.email)
      const { event } = await getEventAndGuest(client, calendr._id, params.event, guestEmail)
      editingEvent = event
    }

    const context: UIContext = {
      workspaceUrl,
      schedule: {
        id: schedule._id,
        title: schedule.title,
        description: extractTextFromMarkup(schedule.description),
        meetingDuration: schedule.meetingDuration
      },
      person: {
        id: person._id,
        uuid: person.personUuid!,
        name: formatName(person.name, process.env.LAST_NAME_FIRST),
        avatarName,
        avatarColor,
      },
      calendar: {
        id: calendr._id,
        ids: calendars.map((c) => c._id),
      },
      edit:
        editingEvent !== undefined && guestEmail !== undefined
          ? {
              mode: 'cancel',
              email: guestEmail,
              event: {
                objectId: editingEvent._id,
                eventId: editingEvent.eventId,
                date: editingEvent.date,
                dueDate: editingEvent.dueDate,
              }
            }
          : undefined
    }
    log.debug('CONTEXT', context)

    return context
  })

  if (!res.ok) {
    throw { status: res.status }
  }
  return res.data
}

export async function getScheduleAndHost(
  client: TxOperations,
  scheduleId: string
): Promise<{
  schedule: Schedule
  hostPerson: Person
  hostSocialId: SocialIdentity
}> {
  const projection: Projection<Schedule> = {
    owner: 1, title: 1, timeZone: 1
  }
  const schedule = await client.findOne(
    calendar.class.Schedule,
    {
      _id: scheduleId as Ref<Schedule>
    },
    {
      projection: {
        ...projection,
        'love:mixin:MeetingSchedule': 1
      } as any
    }
  )
  log.debug('SCHEDULE', schedule)
  if (schedule === undefined) {
    throw { status: 404, message: 'Schedule not found for' + scheduleId }
  }

  const hostPerson = await client.findOne(contact.class.Person, { _id: schedule.owner })
  log.debug('HOST_PERSON', hostPerson)
  if (hostPerson === undefined) {
    throw { status: 404, message: 'Person not found for ' + schedule.owner }
  }

  const hostSocialId = await client.findOne(contact.class.SocialIdentity, {
    attachedTo: hostPerson._id,
    attachedToClass: contact.class.Person,
    type: SocialIdType.EMAIL
  })
  log.debug('HOST_SOCIAL_ID', hostSocialId)
  if (hostSocialId === undefined) {
    throw { status: 404, message: 'Email not found for ' + schedule.owner }
  }

  return { schedule, hostPerson, hostSocialId }
}

export async function getEventAndGuest(
  client: TxOperations | RestClient,
  calendarId: string,
  eventId: string,
  guestEmail: string
): Promise<{
  event: Event
  guestPerson: Person
  participants: { person: Person; email: string }[]
}> {
  const event = await client.findOne(calendar.class.Event, {
    calendar: calendarId as Ref<Calendar>,
    eventId: eventId
  })
  log.debug('EVENT', event)
  if (event === undefined) {
    throw { status: 404, message: 'Event not found for ' + eventId }
  }

  const participants = []

  let guestPerson: Person | undefined
  const persons = await client.findAll(contact.class.Person, {
    _id: { $in: event.participants }
  })
  for (const person of persons) {
    const socialId = await client.findOne(contact.class.SocialIdentity, {
      attachedTo: person._id,
      attachedToClass: contact.class.Person,
      type: SocialIdType.EMAIL
    })
    if (socialId === undefined) {
      continue
    }
    if (socialId.value === guestEmail) {
      guestPerson = person
    }
    participants.push({ person, email: socialId.value })
  }
  log.debug('GUEST_PERSON', guestPerson)
  log.debug('PARTICIPANTS', participants)
  if (guestPerson === undefined) {
    throw { status: 404, message: 'Person not found for ' + guestEmail }
  }

  return { event, guestPerson, participants }
}

export function makeIcal(
  schedule: Schedule,
  event: Event,
  guestPerson: Person,
  participants: { person: Person; email: string }[],
  options?: {
    canceled?: boolean
    declined?: Ref<Person>
    sequence?: number,
    location?: string,
  }
): string {
  const now = Date.now()
  const guestName = formatName(guestPerson.name, process.env.LAST_NAME_FIRST)
  return ical({
    prodId: '-//Huly//Huly Schedule//EN',
    method: options?.canceled ? ICalCalendarMethod.CANCEL : ICalCalendarMethod.REQUEST,
    scale: 'GREGORIAN',
    events: [
      {
        id: event.eventId,
        sequence: (event.modifiedOn ?? now) - (event.createdOn ?? now) + (options?.sequence ?? 0),
        start: new Date(event.date),
        end: new Date(event.dueDate),
        summary: `${schedule.title} (${guestName})`,
        description: extractTextFromMarkup(event.description),
        stamp: new Date(event.modifiedOn ?? now),
        created: new Date(event.createdOn ?? now),
        lastModified: new Date(event.modifiedOn ?? now),
        transparency: ICalEventTransparency.OPAQUE,
        class: ICalEventClass.PUBLIC,
        status: options?.canceled ? ICalEventStatus.CANCELLED : ICalEventStatus.CONFIRMED,
        location: options?.location ?? event.location ?? '',
        // Both Google and Outlook do not add event into calendar
        // if organizer is the same as the calendar owner.
        // It seems they consider the event must be already in the calendar
        // and no external service is supposed to add events in their calendar via emails
        // When organizer is empty, this is ok,
        // Google just shows in the event: "unknownorganizer@calendar.google.com"
        // organizer: {
        //   name: host.name,
        //   email: host.email,
        //   mailto: host.email,
        // },
        attendees: participants.map((p) => {
          const name = formatName(p.person.name, process.env.LAST_NAME_FIRST)
          const isGuest = p.person._id === guestPerson._id
          const overrideEmail = isGuest ? process.env.OVERRIDE_GUEST_EMAIL : process.env.OVERRIDE_HOST_EMAIL
          const e: ICalAttendeeData = {
            name,
            email: overrideEmail ?? p.email,
            mailto: overrideEmail ?? p.email,
            //rsvp: true,
            role: ICalAttendeeRole.REQ,
            status: options?.declined === p.person._id ? ICalAttendeeStatus.DECLINED : ICalAttendeeStatus.ACCEPTED,
            type: ICalAttendeeType.INDIVIDUAL
          }
          return e
        })
      }
    ]
  }).toString()
}

export interface EmailTemplateParams {
  header: string
  subject: string
  scheduleTitle: string
  hostName: string
  hostEmail: string
  guestName: string
  guestEmail: string
  time: string
  agenda: string
  linkJoin?: string
  linkReschedule?: string
  linkCancel?: string
  linkBook?: string
}

export function prepareEmailTemplateParams(
  request: {
    originUrl?: string
    workspaceUrl?: string
    timeZone?: string
    language?: string
  },
  header: string,
  schedule: Schedule,
  event: Event,
  hostPerson: Person,
  hostEmail: string,
  guestPerson: Person,
  guestEmail: string,
  overrides: Partial<EmailTemplateParams> = {}
): EmailTemplateParams {
  const tz = request.timeZone ?? schedule.timeZone
  const lang = request.language ?? 'en'
  const linkSchedule = request.originUrl ? `${request.originUrl}/${request.workspaceUrl}/${schedule._id}` : undefined
  const linkEvent = linkSchedule ? `${linkSchedule}/${event.eventId}-${encodeURIComponent(guestEmail)}` : undefined
  const hostName = formatName(hostPerson.name, process.env.LAST_NAME_FIRST)
  const guestName = formatName(guestPerson.name, process.env.LAST_NAME_FIRST)
  return {
    header,
    subject: `${header}: ${schedule.title} (${guestName}) ` + `@ ${formatTimeslotShort(event, tz, lang)} (${hostName})`,
    scheduleTitle: schedule.title,
    hostName,
    hostEmail,
    guestName,
    guestEmail,
    time: formatTimeslotLong(event, tz, lang),
    agenda: extractTextFromMarkup(event.description),
    linkJoin: event.location,
    linkCancel: linkEvent,
    linkReschedule: linkEvent ? `${linkEvent}/reschedule` : undefined,
    linkBook: linkSchedule,
    ...overrides
  }
}

export async function sendEmail(to: string, params: EmailTemplateParams, ical: string): Promise<void> {
  try {
    if (!process.env.SMTP_URL) {
      log.error('SMTP_URL is not defined')
      return
    }
    const res = await fetch(concatLink(process.env.SMTP_URL, '/send'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to,
        //apiKey: process.env.SMTP_API_KEY,
        subject: params.subject,
        text: Mustache.render(emailText, params),
        html: Mustache.render(emailHtml, params),
        attachments: [
          {
            filename: 'invite.ics',
            content: ical,
            contentType: 'text/calendar; charset=utf-8'
          }
        ]
      })
    })
    if (res.status !== 200) {
      log.error(`Email sending failed to ${to}`, params.subject, res.statusText)
    } else {
      log.info(`Email sent to ${to}`, params.subject)
    }
  } catch (err) {
    log.error(`Email sending failed to ${to}`, params.subject, err)
  }
}

function formatTimeslotLong(event: Event, timeZone: string, locale: string): string {
  const dtFormatter = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone
  })

  const tzFormatter = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'long' })
  const parts = tzFormatter.formatToParts(event.date)
  let tzName = parts.find((p) => p.type === 'timeZoneName')?.value || ''
  if (tzName !== '') {
    const tzFormatter = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' })
    const parts = tzFormatter.formatToParts(event.dueDate)
    const tzOffset = parts.find((p) => p.type === 'timeZoneName')?.value
    if (tzOffset !== undefined) {
      tzName = `(${tzOffset}) ${tzName}`
    }
  }

  return `${dtFormatter.formatRange(event.date, event.dueDate)} ${tzName}`
}

function formatTimeslotShort(event: Event, timeZone: string, locale: string): string {
  const dtFormatter = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone
  })

  const tzFormatter = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' })
  const parts = tzFormatter.formatToParts(event.date)
  let tzName = parts.find((p) => p.type === 'timeZoneName')?.value || ''

  return `${dtFormatter.formatRange(event.date, event.dueDate)} ${tzName}`
}

function extractTextFromMarkup(text: string | undefined): string {
  let result = ''

  function processJson(data: { [k: string]: any }): void {
    for (const key in data) {
      const value = data[key]
      if (key === 'text') {
        result += `${value} `
      } else if (typeof value === 'object') {
        processJson(value)
      }
    }
  }

  if (text === undefined) {
    return ''
  }

  try {
    const json = JSON.parse(text)
    processJson(json)
    return result
  } catch (err) {
    return text
  }
}

export async function getMeetingLinks({
  accountClient,
  workspaceUrl,
  eventObjectId,
  guestName,
  guestEmail,
  slotStart,
}: {
  accountClient: AccountClient,
  workspaceUrl: string,
  eventObjectId: Ref<Event>,
  guestName: string,
  guestEmail: string,
  slotStart: Timestamp,
}) : Promise<{ meetingLink: string, guestLink: string }> {
  let inviteExpHours = parseFloat(process.env.INVITE_EXPIRATION_HOURS ?? '1')
  if (isNaN(inviteExpHours) || inviteExpHours < 0) {
    inviteExpHours = 1
  }

  const navigateUrl = encodeURIComponent(
    JSON.stringify({
      path: ['workbench', workspaceUrl, loveId],
      query: { meetId: eventObjectId }
    })
  )

  const inviteId = await accountClient.createInvite(-1, '', -1, AccountRole.Guest)
  const meetingUrl = new URL(process.env.FRONT_URL ?? '')
  meetingUrl.pathname = '/login/join'
  meetingUrl.searchParams.set('inviteId', inviteId)
  meetingUrl.searchParams.set('navigateUrl', navigateUrl)
  const meetingLink = meetingUrl.toString()
  log.debug('MEETING_LINK', meetingLink)

  const guestLink = await accountClient.createInviteLink(
    guestEmail,
    AccountRole.Guest,
    true,
    getFirstName(guestName),
    getLastName(guestName),
    navigateUrl,
    (slotStart - Date.now()) / 3_600_000 + inviteExpHours
  )
  log.debug('GUEST_LINK', guestLink)

  return { meetingLink, guestLink }
}
