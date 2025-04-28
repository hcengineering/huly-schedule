export type Timestamp = number

export interface UIContext {
  workspaceUrl: string
  schedule: {
    id: string
    title: string
    description: string
    meetingDuration: number
  }
  person: {
    id: string
    uuid: string
    name: string
    avatarName: string
    avatarColor: string
  }
  calendar: {
    id: string,
    ids: string[],
  }
  edit?: {
    mode: 'cancel' | 'reschedule'
    email: string
    event: {
      objectId: string
      eventId: string
      date: Timestamp,
      dueDate: Timestamp,
    }
  }
}

export interface Timeslot {
  start: Timestamp
  end: Timestamp
}

export type TimeslotsByDay = Record<number, Timeslot[]>

export type TimeslotsRequest = {
  workspaceUrl: string
  personId: string
  scheduleId: string
  calendarIds: string[]
  clientNow: Timestamp
  periodStart: Timestamp
  periodDays: number
}

export interface BookingInfo {
  firstName: string
  lastName: string
  email: string
  subject: string
}

export type ClientRequest = {
  originUrl: string
  workspaceUrl: string
  personUuid: string
  personId: string
  scheduleId: string
  calendarId: string
  calendarIds: string[]
  timeZone: string
  language: string
}

export type BookingRequest = ClientRequest & {
  booking: BookingInfo
  timeslot: Timeslot
}

export type CancelRequest = ClientRequest & {
  eventId: string
  guestEmail: string
}

export type RescheduleRequest = ClientRequest & {
  eventId: string
  guestEmail: string
  timeslot: Timeslot
}

export interface BookingResponse {
  eventId: string
  ical: string
}
