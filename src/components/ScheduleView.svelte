<script lang="ts">
  import log from 'loglevel'
  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import { quintOut } from 'svelte/easing'
  import Modal, { type Component, bind } from './Modal.svelte'
  import BookingForm from './BookingForm.svelte'
  import CancelationForm from './CancelationForm.svelte'
  import ReschedulingForm from './ReschedulingForm.svelte'
  import MonthView from './MonthView.svelte'
  import ShevronIcon from './ShevronIcon.svelte'
  import { getTimeslots } from '../scripts/client/api'
  import type { Timeslot, UIContext } from '../scripts/types'
  import { formatLocalTimezone, formatDuration, formatTimeslot } from '../scripts/client/utils'

  export let context: UIContext

  let startDate = new Date()
  let days: WeekDay[] = []
  let totalTimeslots = 0
  let maxTimeslotsInDay = 0
  let loading = false
  let modal: Component | undefined
  let isCancelModalOpen = false
  let periodDays = 7
  let weekView: HTMLDivElement | undefined

  const minDayWidth = 150

  interface WeekDay {
    isToday: boolean
    weekDayName: string
    monthDayNum: number
    timeslots: Timeslot[]
    date: Date
  }

  $: queryTimeslots(startDate, weekView)
  $: setResizeObserver(weekView)

  function setResizeObserver(weekView: HTMLDivElement | undefined) {
    if (typeof window === 'undefined' || weekView === undefined) {
      return
    }
    const resizeObserver = new ResizeObserver(() => {
      if (weekView !== undefined) {
        let newPeriodDays = periodDays
        for (let dayCount = 7; dayCount > 0; dayCount--) {
          const dayWidth = weekView.clientWidth / dayCount
          if (dayWidth >= minDayWidth) {
            newPeriodDays = dayCount
            break
          }
        }
        if (newPeriodDays !== periodDays) {
          periodDays = newPeriodDays
          queryTimeslots(startDate, weekView)
        }
      }
    })
    resizeObserver.observe(weekView)
  }

  function queryTimeslots(startDate: Date, weekView: HTMLDivElement | undefined) {
    if (typeof window === 'undefined' || weekView === undefined || loading) {
      return
    }
    loading = true
    getTimeslots(context, startDate, periodDays)
      .then((timeslots) => {
        loading = false
        updateWeek(timeslots as Record<number, Timeslot[]>)
      })
      .catch((err) => {
        loading = false
        log.error('Failed to get timeslots for week', err)
      })
  }

  function updateWeek(weekTimeslots: Record<number, Timeslot[]>) {
    days = []
    totalTimeslots = 0
    maxTimeslotsInDay = 0
    const today = new Date()
    const todayMonth = today.getMonth()
    const todayDay = today.getDate()
    for (let day = 0; day < periodDays; day++) {
      const date = new Date(startDate)
      date.setDate(date.getDate() + day)
      const timeslots = weekTimeslots[day] ?? []
      totalTimeslots += timeslots.length
      if (timeslots.length > maxTimeslotsInDay) {
        maxTimeslotsInDay = timeslots.length
      }
      days.push({
        isToday: todayMonth === date.getMonth() && todayDay === date.getDate(),
        weekDayName: date.toLocaleDateString(navigator.language, { weekday: 'short' }).toUpperCase(),
        monthDayNum: date.getDate(),
        timeslots,
        date
      })
    }
  }

  function startBooking(timeslot: Timeslot) {
    const onBooked = (email: string, eventId: string, ical: string) => {
      modal = undefined
      // TODO: there could be a strange case when the old and new components
      // are rendered in the same modal window. In this case the modal will
      // be closed before the new component is rendered. This is a workaround
      setTimeout(() => {
        isCancelModalOpen = true
        modal = bind(CancelationForm, {
          context,
          timeslot,
          eventId,
          email,
          ical,
          onCanceled: () => {
            modal = undefined
          }
        })
      }, 500)
    }

    if (context.edit?.mode === 'reschedule') {
      modal = bind(ReschedulingForm, {
        context,
        oldTimeslot: {
          start: context.edit.event.date,
          end: context.edit.event.dueDate
        },
        newTimeslot: timeslot,
        eventId: context.edit.event.eventId,
        email: context.edit.email,
        onRefresh: refresh,
        onBooked
      })
    } else {
      modal = bind(BookingForm, {
        context,
        timeslot,
        onRefresh: refresh,
        onBooked
      })
    }
  }

  function showPrevPeriod() {
    const d = new Date(startDate)
    d.setDate(d.getDate() - periodDays)
    startDate = d
  }

  function showNextPeriod() {
    const d = new Date(startDate)
    d.setDate(d.getDate() + periodDays)
    startDate = d
  }

  let findPeriodTry = 0
  const maxFindPeriodTry = 100

  function showNextAvailablePeriod() {
    findPeriodTry = 0
    findNextPeriod(new Date())
  }

  function findNextPeriod(periodStart: Date) {
    loading = true
    getTimeslots(context, periodStart, periodDays)
      .then((timeslots) => {
        if (Object.keys(timeslots).length > 0) {
          loading = false
          for (let day = 0; day < periodDays; day++) {
            const date = new Date(periodStart)
            date.setDate(date.getDate() + day)
            const timeslotsForDay = (timeslots[day] ?? []) as Timeslot[]
            if (timeslotsForDay.length > 0) {
              startDate = date
              break
            }
          }
        } else if (findPeriodTry > maxFindPeriodTry) {
          loading = false
          startDate = new Date()
          log.error('Unable to find availble period')
        } else {
          findPeriodTry++
          const nextPeriod = new Date(periodStart)
          nextPeriod.setDate(nextPeriod.getDate() - periodDays)
          setTimeout(() => {
            findNextPeriod(nextPeriod)
          }, 0)
        }
      })
      .catch((err) => {
        loading = false
        log.error('Failed to search next period', err)
      })
  }

  function refresh() {
    startDate = new Date(startDate)
  }

  function mainLocation(): string {
    if (typeof window === 'undefined') {
      return ''
    }
    return `${window.location.origin}/${context.workspaceUrl}/${context.schedule.id}`
  }

  onMount(() => {
    if (context.edit?.mode === 'cancel') {
      isCancelModalOpen = true
      modal = bind(CancelationForm, {
        context,
        timeslot: {
          start: context.edit.event.date,
          end: context.edit.event.dueDate
        },
        eventId: context.edit.event.eventId,
        email: context.edit.email,
        onCanceled: () => {
          modal = undefined
        }
      })
    }
  })
</script>

<main>
  {#if context.edit?.mode === 'reschedule' && !import.meta.env.SSR}
    <div class="reschedule">
      <h1>Meeting booked</h1>
      <span>{@html formatTimeslot({ start: context.edit.event.date, end: context.edit.event.dueDate })}</span>
      <span>Invitation sent to <a href={`mailto:${context.edit.email}`}>{context.edit.email}</a></span>
      <h2>Select another time for the meeting or <a href={mainLocation()}>book another meeting</a></h2>
    </div>
  {/if}
  <Modal
    closeOnEsc={false}
    closeOnOuterClick={false}
    on:close={() => {
      if (isCancelModalOpen) {
        isCancelModalOpen = false
        window.location.href = mainLocation()
      }
    }}
    styleWindow={{
      width: '30rem',
      padding: '1.2rem',
      borderRadius: '0.75rem',
      backgroundColor: 'var(--bg-color)'
    }}
    show={modal}
  />
  <div class="title">
    <span>Select a meeting time</span>
    <div class="duration">
      <svg width="20" height="20" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="9.25" fill="none" stroke-width="1.5" />
        <path stroke="none" d="m10 3a7 7 0 0 1 6.75 5.17 7 7 0 0 1-3.21 7.87 7 7 0 0 1-8.44-1.03l4.89-5.01z" />
      </svg>
      <span>
        {formatDuration(context.schedule.meetingDuration)} meetings
      </span>
    </div>
    <span class="tz">{formatLocalTimezone()}</span>
  </div>
  <div class="loader">
    {#if loading}
      <span class="progress" transition:fade={{ duration: 350, easing: quintOut }}></span>
    {/if}
  </div>
  <div class="schedule">
    <div class="month">
      <MonthView {context} {startDate} disabled={loading} onSelect={(date) => (startDate = date)} />
    </div>
    <div class="week" bind:this={weekView}>
      <div class="days">
        {#each days as day, dayIdx}
          <div class="day">
            <div class="dayHeader" class:empty={totalTimeslots === 0}>
              {#if dayIdx == 0}
                <button class="light prev" disabled={loading} on:click={showPrevPeriod}>
                  <ShevronIcon direction="left" />
                </button>
              {/if}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="dayNum" class:current={day.isToday} on:click={() => (startDate = day.date)}>
                <div>{day.weekDayName}</div>
                <div class="monthDay">{day.monthDayNum}</div>
              </div>
              {#if dayIdx == days.length - 1}
                <button class="light next" disabled={loading} on:click={showNextPeriod}>
                  <ShevronIcon direction="right" />
                </button>
              {/if}
            </div>
            {#each day.timeslots as timeslot}
              <button class="timeslot button" disabled={loading} on:click={() => startBooking(timeslot)}>
                {new Date(timeslot.start).toLocaleTimeString(navigator.language, {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </button>
            {/each}
            {#if day.timeslots.length < maxTimeslotsInDay}
              {#each Array(maxTimeslotsInDay - day.timeslots.length) as _}
                <div class="timeslot">
                  <div class="placeholder"></div>
                </div>
              {/each}
            {/if}
          </div>
        {/each}
      </div>
      {#if totalTimeslots === 0}
        <div class="empty">
          No availability during these days
          <button class="primary" disabled={loading} on:click={showNextAvailablePeriod}>
            Jump to the next available date
          </button>
        </div>
      {/if}
    </div>
  </div>
</main>

<style>
  .title {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 2rem;

    .duration {
      display: flex;
      align-items: center;
      font-size: 0.875rem;

      svg {
        margin-right: 0.5rem;
        fill: #444;
        stroke: #444;
      }
    }

    .tz {
      font-size: 0.875rem;
    }
  }

  .schedule {
    display: flex;
    flex-direction: row;

    .month {
      margin-right: 3rem;
    }

    .week {
      display: flex;
      flex-direction: column;
      flex: 1;
    }

    .days {
      display: flex;
      flex-direction: row;
    }

    .empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;

      button {
        padding: 0.5rem 1rem;
      }
    }
  }

  .day {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: stretch;
    flex: 1;
  }

  .dayHeader {
    position: relative;
    display: flex;
    flex-direction: row;
    justify-content: center;
    height: 3.2rem;
    min-height: 3.2rem;
    margin-bottom: 1rem;

    &.empty {
      margin-bottom: 0;
    }

    .dayNum {
      height: 100%;
      aspect-ratio: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      font-size: 0.75rem;
      cursor: pointer;

      &:hover {
        background-color: var(--button-light-hover-color);
      }

      &.current {
        background-color: var(--accent-color);
        color: var(--accent-text-color);

        &:hover {
          background-color: var(--accent-alt-color);
        }
      }

      .monthDay {
        font-size: 1.25rem;
      }
    }

    button {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 3rem;
      height: 3rem;
      opacity: 0.75;

      &.prev {
        left: 0%;
      }

      &.next {
        right: 0%;
      }
    }
  }

  .timeslot {
    display: flex;
    justify-content: center;
    align-items: center;
    margin: 0.25rem 0.5rem;
    height: 2.5rem;

    &.button {
      background-color: var(--bg-color);
      border: 1px solid var(--border-color);
      color: var(--accent-color);
      font-size: 1rem;

      &:hover {
        background-color: var(--button-light-hover-color);
      }
    }

    .placeholder {
      width: 1.5rem;
      height: 2px;
      background-color: black;
      opacity: 0.2;
    }
  }

  .reschedule {
    position: absolute;
    box-shadow: 0px 10px 20px 0px rgba(0, 0, 0, 0.4);
    left: 50%;
    transform: translateX(-50%);
    top: -6rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    background-color: white;
    border: 1px solid var(--border-color);
    border-radius: 0.5rem;
    padding: 1.2rem;
    z-index: 1;

    h1 {
      font-size: 1.3rem;
      margin: 0 0 0.5rem 0;
    }

    h2 {
      font-size: 1rem;
      margin: 0.5rem 0 0 0;
    }
  }

  .loader {
    position: relative;

    .progress {
      position: absolute;
      left: 0;
      right: 0;
      top: -16px;
      bottom: 12px;
      display: inline-block;
      background-color: var(--accent-alt-color);
      background-image: linear-gradient(-45deg, rgba(255, 255, 255, 0.5) 25%, transparent 25%, transparent 50%, rgba(255, 255, 255, 0.5) 50%, rgba(255, 255, 255, 0.5) 75%, transparent 75%, transparent);
      font-size: 30px;
      background-size: 1em 1em;
      box-sizing: border-box;
      animation: barStripe 0.5s linear infinite;
      border-radius: 2px;
    }
  }

  @keyframes barStripe {
    0% {
      background-position: 1em 0;
    }
    100% {
      background-position: 0 0;
    }
  }
</style>
