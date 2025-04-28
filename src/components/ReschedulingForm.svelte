<script lang="ts">
  import { rescheduleMeeting } from '../scripts/client/api'
  import { formatLocalTimezone, formatTimeslot } from '../scripts/client/utils'
  import type { Timeslot, UIContext } from '../scripts/types'

  export let context: UIContext
  export let oldTimeslot: Timeslot
  export let newTimeslot: Timeslot
  export let eventId: string
  export let email: string
  export let onRefresh: () => void
  export let onBooked: (email: string, eventId: string, ical: string) => void

  let loading = false
  let errorKind: 'conflict' | 'unknown' | undefined

  function handleReschedule() {
    loading = true
    rescheduleMeeting(context, eventId, email, newTimeslot)
      .then((res) => {
        loading = false
        errorKind = undefined
        if (res === 'conflict') {
          errorKind = 'conflict'
          onRefresh()
        } else if (res === 'error') {
          errorKind = 'unknown'
        } else {
          onBooked(email, eventId, res)
        }
      })
      .catch((err) => {
        loading = false
        console.error('Failed to book meeting', err)
      })
  }

</script>

<div class="root">
  <h1>{context.schedule.title}</h1>

  <div class="block">
    <span class="obsolete">{@html formatTimeslot(oldTimeslot)}</span>
    <span class="obsolete" style="opacity: 0.4">{formatLocalTimezone()}</span>
  </div>

  <div class="block">
    <h2>New time</h2>
    <span>{@html formatTimeslot(newTimeslot)}</span>
    <span style="opacity: 0.4">{formatLocalTimezone()}</span>
  </div>

  {#if errorKind === 'conflict'}
    <div class="error">
      There is already a meeting scheduled for this time.<br />
      Please choose another time or try other dates.
    </div>
  {:else if errorKind === 'unknown'}
    <div class="error">
      An error occurred while booking the meeting.<br />
      Please try one more time or choose other dates.
    </div>
  {/if}

  <button class="push primary" disabled={loading} on:click={handleReschedule}>Reschedule</button>
</div>

<style>
  h1 {
    font-size: 1.3rem;
  }

  h2 {
    font-size: 1rem;
  }

  .root {
    display: flex;
    flex-direction: column;
    gap: 1.5em;
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
  }

  button {
    margin-top: 1rem;
    letter-spacing: 0.06em;
  }

  .obsolete {
    text-decoration: line-through;
  }

  .error {
    font-size: 0.8rem;
    color: var(--error-text-color);
    line-height: 1.3;
    letter-spacing: 0.02em;
  }
</style>
