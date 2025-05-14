<script lang="ts">
  import log from 'loglevel'
  import ShevronIcon from './ShevronIcon.svelte'
  import { sameDate } from '../scripts/client/utils'
  import { getTimeslots } from '../scripts/client/api'
  import type { UIContext } from '../scripts/types'

  export let context: UIContext
  export let disabled = false
  export let startDate: Date
  export let onSelect: (date: Date) => void

  interface MonthDay {
    isAux?: boolean
    isToday?: boolean
    hasTimeslots?: boolean
    date: Date
  }

  let loading = false
  let monthDays: MonthDay[] = []
  let weekDayNames: string[] = []
  let monthName = ''

  $: updateMonthDays(startDate)

  function updateMonthDays(startDate: Date) {
    if (typeof window === 'undefined') {
      return ''
    }
    const days: MonthDay[] = []
    const locale = new Intl.Locale(navigator.language)
    let weekStart = typeof (locale as any)?.getWeekInfo === 'function'
      ? (locale as any)?.getWeekInfo()?.firstDay
      : (locale as any).weekInfo?.firstDay ?? 1
    //weekStart = 1
    const today = new Date()
    const firstDay = new Date(startDate)
    firstDay.setDate(1)
    const auxDays = (firstDay.getDay() + 7 - weekStart) % 7
    for (let i = auxDays; i > 0; i--) {
      const auxDay = new Date(firstDay.getTime() - 86_400_000 * i)
      days.push({ date: auxDay, isAux: true })
    }
    let dayCount = 0
    while (true) {
      const day = new Date(firstDay)
      day.setDate(day.getDate() + dayCount)
      if (day.getMonth() !== firstDay.getMonth()) {
        if (days.length % 7 > 0) {
          const auxDays = 7 - (days.length % 7)
          for (let i = 0; i < auxDays; i++) {
            const auxDay = new Date(firstDay.getTime() + 86_400_000 * (dayCount + i))
            days.push({ date: auxDay, isAux: true })
          }
        }
        break
      }
      days.push({ date: day, isToday: sameDate(day, today) })
      dayCount++;
    }

    let lang = navigator.language
    //lang = 'en'
    monthDays = days
    monthName = firstDay.toLocaleDateString(lang, { month: 'long' }) + ' ' + firstDay.getFullYear()
    weekDayNames = []
    const weekDayFormat = days[0].date.toLocaleDateString(lang, { weekday: 'short' }).length > 2 ? 'narrow' : 'short'
    for (let i = 0; i < 7; i++) {
      weekDayNames.push(days[i].date.toLocaleDateString(lang, { weekday: weekDayFormat }).toUpperCase())
    }

    loading = true
    getTimeslots(context, days[0].date, days.length)
      .then((timeslots) => {
        loading = false
        for (let day = 0; day < days.length; day++) {
          if (timeslots[day].length > 0) {
            days[day].hasTimeslots = true
          }
        }
        monthDays = [...days]
      })
      .catch((err) => {
        loading = false
        log.error('Failed to get timeslots for month', err);
      })
  }

  function showPrevMonth() {
    const d = new Date(startDate)
    d.setMonth(d.getMonth() - 1)
    d.setDate(1)
    onSelect(d)
  }

  function showNextMonth() {
    const d = new Date(startDate)
    d.setMonth(d.getMonth() + 1)
    d.setDate(1)
    onSelect(d)
  }
</script>

<div class="root">
  <div class="header">
    <div class="month">{monthName}</div>
    <div>
      <button class="light" disabled={disabled || loading} on:click={showPrevMonth}>
        <ShevronIcon direction="left" size={10} />
      </button>
      <button class="light" disabled={disabled || loading} on:click={showNextMonth}>
        <ShevronIcon direction="right" size={10} />
      </button>
    </div>
  </div>

  <div class="weekdays">
    {#each weekDayNames as dayName}
      <span class="day">
        {dayName}
      </span>
    {/each}
  </div>
  <div class="days">
    {#each monthDays as day, i}
      <button
        class="day"
        class:aux={day.isAux}
        class:primary={day.isToday}
        class:light={!day.isToday}
        class:selected={!day.isToday && sameDate(day.date, startDate)}
        class:hasTimeslots={!day.isToday && day.hasTimeslots}
        disabled={disabled || loading}
        on:click={() => { onSelect(day.date) }}
      >
        {day.date.getDate()}
      </button>
    {/each}
  </div>
</div>

<style>
  .root {
    display: flex;
    flex-direction: column;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;

    .month {
      font-weight: 500;

      &::first-letter {
        text-transform: capitalize;
      }
    }

    button {
      padding: 0.5rem 0.6rem;

      &:first-child {
        margin-right: 0.5rem;
      }
    }
  }

  .weekdays {
    display: flex;
    margin-bottom: 0.5rem;

    .day {
      width: 2rem;
      height: 2rem;
      margin: 1px;
      display: flex;
      justify-content: center;
      align-items: center;
      font-size: 0.75rem;
    }
  }

  .days {
    display: grid;
    grid-template-columns: repeat(7, 1fr);

    .day {
      display: flex;
      justify-content: center;
      align-items: center;
      width: 2rem;
      height: 2rem;
      margin: 1px;
      font-size: 0.75rem;

      &.aux {
        color: rgba(0, 0, 0, 0.3);
      }

      &.selected {
        border: 2px solid var(--border-color);
        background-color: var(--bg-color);

        &:hover {
          background-color: var(--button-light-hover-color);
        }
      }

      &.hasTimeslots {
        background-color: var(--bg-color);
        color: var(--accent-color);

        &:hover {
          background-color: var(--button-light-hover-color);
          border: 1px solid var(--border-color);

          &.selected {
            border-width: 2px;
          }
        }
      }
    }
  }
</style>
