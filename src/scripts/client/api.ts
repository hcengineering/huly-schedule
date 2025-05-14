import log from 'loglevel'
import type {
  BookingInfo,
  BookingRequest,
  BookingResponse,
  CancelRequest,
  RescheduleRequest,
  Timeslot,
  TimeslotsByDay,
  TimeslotsRequest,
  UIContext
} from '../types'

export async function getTimeslots(context: UIContext, startDate: Date, periodDays: number): Promise<TimeslotsByDay> {
  if (startDate.getTime() + periodDays * 86_400_000 < new Date().getTime()) {
    return []
  }

  const req: TimeslotsRequest = {
    workspaceUrl: context.workspaceUrl,
    personId: context.person.id,
    scheduleId: context.schedule.id,
    calendarIds: context.calendar.ids,
    clientNow: new Date().getTime(),
    periodStart: startDate.getTime(),
    periodDays
  }
  const response = await fetch(`/api/timeslots`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(req)
  })
  if (!response.ok) {
    log.error('Failed to get timeslots:', response.status)
    return []
  }

  const timeslotsByDay: TimeslotsByDay = {}
  const timeslots: Timeslot[] = await response.json()
  for (let day = 0; day < periodDays; day++) {
    const date = new Date(startDate)
    date.setDate(date.getDate() + day)

    date.setHours(0, 0, 0, 0)
    const dayStart = date.getTime()

    date.setHours(23, 59, 59, 999)
    const dayEnd = date.getTime()

    const dayTimeslots = timeslots.filter((timeslot) => {
      return timeslot.start >= dayStart && timeslot.start <= dayEnd
    })
    timeslotsByDay[day] = dayTimeslots
  }
  return timeslotsByDay
}

export async function bookMeeting(
  context: UIContext,
  timeslot: Timeslot,
  booking: BookingInfo
): Promise<'conflict' | 'error' | BookingResponse> {
  const req: BookingRequest = {
    personId: context.person.id,
    personUuid: context.person.uuid,
    originUrl: window.location.origin,
    workspaceUrl: context.workspaceUrl,
    scheduleId: context.schedule.id,
    calendarId: context.calendar.id,
    calendarIds: context.calendar.ids,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    timeslot,
    booking
  }

  const response = await fetch(`/api/book`, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(req)
  })
  if (!response.ok) {
    log.error('Failed to book meeting:', response.status)
    if (response.status === 409) {
      return 'conflict'
    }
    return 'error'
  }
  const res: any = await response.json()
  return res
}

export async function cancelMeeting(
  context: UIContext,
  eventId: string,
  guestEmail: string
): Promise<'not-found' | 'error' | 'ok'> {
  const req: CancelRequest = {
    personUuid: context.person.uuid,
    personId: context.person.id,
    originUrl: window.location.origin,
    workspaceUrl: context.workspaceUrl,
    scheduleId: context.schedule.id,
    calendarId: context.calendar.id,
    calendarIds: context.calendar.ids,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    eventId,
    guestEmail
  }

  const response = await fetch(`/api/cancel`, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(req)
  })
  if (!response.ok) {
    log.error('Failed to cancel meeting:', response.status)
    if (response.status === 404) {
      return 'not-found'
    }
    return 'error'
  }
  return 'ok'
}

export async function rescheduleMeeting(
  context: UIContext,
  eventId: string,
  guestEmail: string,
  timeslot: Timeslot
): Promise<'conflict' | 'error' | string> {
  const req: RescheduleRequest = {
    personUuid: context.person.uuid,
    personId: context.person.id,
    originUrl: window.location.origin,
    workspaceUrl: context.workspaceUrl,
    scheduleId: context.schedule.id,
    calendarId: context.calendar.id,
    calendarIds: context.calendar.ids,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    eventId,
    guestEmail,
    timeslot
  }

  const response = await fetch(`/api/reschedule`, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(req)
  })
  if (!response.ok) {
    log.error('Failed to book meeting:', response.status)
    if (response.status === 409) {
      return 'conflict'
    }
    return 'error'
  }
  return await response.text()
}
