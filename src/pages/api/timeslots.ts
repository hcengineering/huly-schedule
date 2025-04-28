import type { APIRoute, APIContext } from 'astro'
import type { Contact } from '@hcengineering/contact'
import type { FindOptions, Ref, Storage } from '@hcengineering/core'
import calendar, {
  type Calendar,
  type Event,
  type ReccuringEvent,
  type ReccuringInstance,
  type Schedule,
  getAllEvents
} from '@hcengineering/calendar'
import type { TimeslotsRequest, Timeslot, Timestamp } from '../../scripts/types'
import { apiCall } from '../../scripts/server/api'

export async function loadEvents(
  client: Storage,
  calendarIds: String[],
  periodStart: Timestamp,
  periodEnd: Timestamp,
  personId: String
): Promise<Event[]> {
  const options: FindOptions<Event & ReccuringEvent & ReccuringInstance> = {
    projection: {
      eventId: 1,
      date: 1,
      dueDate: 1,
      allDay: 1,
      timeZone: 1,
      rules: 1,
      exdate: 1,
      rdate: 1,
      originalStartTime: 1,
      recurringEventId: 1,
      isCancelled: 1,
      participants: 1
    }
  }
  const events1 = await client.findAll(
    calendar.class.Event,
    {
      calendar: { $in: calendarIds as Ref<Calendar>[] },
      date: { $gt: periodStart - 86_400_000, $lte: periodEnd }
    },
    options
  )
  const events2 = await client.findAll(
    calendar.class.ReccuringEvent,
    {
      calendar: { $in: calendarIds as Ref<Calendar>[] }
    },
    options
  )
  events1.push(...events2)
  //console.log('EVENTS', calendar, events1)
  const events0 = events1.filter((ev) => ev.participants.includes(personId as Ref<Contact>))
  const events = getAllEvents(events0, periodStart, periodEnd)
  return events
}

export function isSlotBusy(events: Event[], slotStart: Timestamp, slotEnd: Timestamp, tzOffset: number): boolean {
  for (const event of events) {
    let date = event.date
    let dueDate = event.dueDate
    if (event.allDay) {
      let offset = tzOffset
      if (event.timeZone !== undefined) {
        offset = getTimezoneOffset(new Date(date), event.timeZone)
      }
      const d = new Date(date + offset)
      d.setUTCHours(0, 0, 0, 0)
      date = d.getTime()
      dueDate = date + 86_400_000 - 1
    }
    if (
      (date <= slotStart && dueDate >= slotEnd) ||
      (date > slotStart && date < slotEnd) ||
      (dueDate > slotStart && dueDate < slotEnd)
    ) {
      return true
    }
  }
  return false
}

export const POST: APIRoute = async ({ locals, request }: APIContext) => {
  const req: TimeslotsRequest = await request.json()
  console.log('GET_TIMESLOTS', req)

  const { workspaceUrl, scheduleId } = req

  let periodStart = req.periodStart
  const periodEnd = req.periodStart + req.periodDays * 86_400_000
  if (req.clientNow > periodStart) {
    periodStart = req.clientNow
  }

  const res = await apiCall({ workspaceUrl }, async (client) => {
    const schedule = await client.findOne(calendar.class.Schedule, {
      _id: scheduleId as Ref<Schedule>
    })
    if (schedule === undefined) {
      throw { status: 404, message: 'Schedule not found' }
    }
    const events = await loadEvents(client, req.calendarIds, periodStart, periodEnd, req.personId)
    return { events, schedule }
  })
  if (!res.ok) {
    return new Response(null, { status: res.status })
  }
  const { events, schedule } = res.data

  const slotDuration = schedule.meetingDuration
  const slotInterval = schedule.meetingInterval

  const timeslots: Timeslot[] = []

  let tzOffset = getTimezoneOffset(new Date(periodStart), schedule.timeZone)
  let curDate = new Date(periodStart + tzOffset)
  curDate.setUTCHours(0, 0, 0, 0)

  const endDate = new Date(periodEnd + tzOffset)

  while (curDate < endDate) {
    const curTime = curDate.getTime()
    const weekDay = curDate.getUTCDay()
    const availability = schedule.availability[weekDay] ?? []
    if (availability.length > 0) {
      const dayStart = curTime + availability[0].start
      const dayEnd = curTime + availability[0].end
      let slotStart = dayStart
      let slotEnd = slotStart + slotDuration
      while (slotStart < dayEnd && slotEnd <= dayEnd) {
        const start = slotStart - tzOffset
        const end = start + slotDuration
        if (start >= req.clientNow && !isSlotBusy(events, start, end, tzOffset)) {
          timeslots.push({ start, end })
        }
        slotStart = slotEnd + slotInterval
        slotEnd = slotStart + slotDuration
      }
    }
    const nextUtc = curTime - tzOffset + 86_400_000
    tzOffset = getTimezoneOffset(new Date(nextUtc), schedule.timeZone)
    curDate.setUTCDate(curDate.getUTCDate() + 1)
  }

  return new Response(JSON.stringify(timeslots))
}

export function getTimezoneOffset(date: Date, tzId: string): number {
  const utcString = date.toLocaleString('en-US', { timeZone: 'UTC' })
  const tzString = date.toLocaleString('en-US', { timeZone: tzId })
  const utcDate = new Date(utcString)
  const tzDate = new Date(tzString)
  return tzDate.getTime() - utcDate.getTime()
}
