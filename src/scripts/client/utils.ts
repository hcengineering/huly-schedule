import type { Timeslot } from '../types'

export function formatLocalTimezone(): string {
  if (typeof window === 'undefined') {
    return ''
  }
  const date = new Date()

  // Get timezone offset in minutes and convert to hours
  const offsetInMinutes = date.getTimezoneOffset()
  const offsetHours = Math.abs(Math.floor(offsetInMinutes / 60))
  const offsetMinutes = Math.abs(offsetInMinutes % 60)

  // Format the offset string
  const sign = offsetInMinutes <= 0 ? '+' : '-'
  const offsetStr = `GMT${sign}${offsetHours}${offsetMinutes > 0 ? ':' + offsetMinutes.toString().padStart(2, '0') : ''}`

  // Get the long timezone name
  const tzName = new Intl.DateTimeFormat(navigator.language, { timeZoneName: 'long' }).formatToParts(date).find(part => part.type === 'timeZoneName')?.value || ''

  return `(${offsetStr}) ${tzName}`
}

export function sameDate(date1: Date | undefined, date2: Date | undefined): boolean {
  if (date1 === undefined || date2 === undefined) {
    return false
  }
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  )
}

export function formatDuration(duration: number): string {
  let text = ''
  const days = Math.floor(duration / 86_400_000)
  if (days > 0) {
    text += `${days}d`
  }
  const hours = Math.floor((duration % 86_400_000) / 3_600_000)
  if (hours > 0) {
    text += ' '
    text += `${hours}h`
  }
  const minutes = Math.floor((duration % 3_600_000) / 60_000)
  if (minutes > 0) {
    text += ' '
    text += `${minutes}m`
  }
  return text.trim()
}

export function formatTimeslot(timeslot: Timeslot): string {
  const lang = navigator?.language
  if (lang === undefined) {
    return ''
  }
  let formatted = ''
  const dateStart = new Date(timeslot.start)
  const dateEnd = new Date(timeslot.end)
  const timeStrStart = dateStart.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })
  const timeStrEnd = dateEnd.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })
  let dateStrStart = dateStart.toLocaleDateString(lang, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
  dateStrStart = dateStrStart[0].toUpperCase() + dateStrStart.substring(1)
  if (dateStart.getDate() === dateEnd.getDate()) {
    formatted = `${dateStrStart} <b>${timeStrStart} &ndash; ${timeStrEnd}</b>`
  } else {
    let dateStrEnd = dateEnd.toLocaleDateString(lang, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
    formatted = `${dateStrStart} <b>${timeStrStart}</b><br>&nbsp;&nbsp;&nbsp;&ndash; ${dateStrEnd} <b>${timeStrEnd}</b>`
  }
  //formatted += '<br>' + formatLocalTimezone()
  return formatted
}
