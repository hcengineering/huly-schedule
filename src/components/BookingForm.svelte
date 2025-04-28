<script lang="ts">
  import { formatLocalTimezone, formatTimeslot } from '../scripts/client/utils'
  import type { Timeslot, BookingInfo, UIContext } from '../scripts/types'
  import { bookMeeting } from '../scripts/client/api'

  export let context: UIContext
  export let timeslot: Timeslot
  export let onRefresh: () => void
  export let onBooked: (email: string, eventId: string, ical: string) => void

  let loading = false
  let errorKind: 'conflict' | 'unknown' | undefined
  let firstInput: HTMLInputElement | undefined

  let booking: BookingInfo = {
    firstName: '',
    lastName: '',
    email: '',
    subject: ''
  }

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault()
    loading = true
    errorKind = undefined

    bookMeeting(context, timeslot, booking)
      .then((res) => {
        loading = false
        if (res === 'conflict') {
          errorKind = 'conflict'
          onRefresh()
        } else if (res === 'error') {
          errorKind = 'unknown'
        } else {
          onBooked(booking.email, res.eventId, res.ical)
        }
      })
      .catch((err) => {
        loading = false
        console.error('Failed to book meeting', err)
      })
  }

  $: if (firstInput !== undefined && firstInput !== null) {
    firstInput.focus()
  }

  $: canSubmit =
    !loading &&
    booking.firstName.trim() !== '' &&
    booking.lastName.trim() !== '' &&
    booking.email.trim() !== '' &&
    booking.subject.trim() !== ''
</script>

<form on:submit={handleSubmit}>
  <h1>{context.schedule.title}</h1>

  <div>
    <span>{@html formatTimeslot(timeslot)}</span>
    <span style="opacity: 0.4">{formatLocalTimezone()}</span>
  </div>

  <div>
    <label for="person">First name</label>
    <input
      id="firstName"
      type="text"
      placeholder="First name"
      bind:value={booking.firstName}
      bind:this={firstInput}
      required
    />
  </div>

  <div>
    <label for="person">Last name</label>
    <input id="lastName" type="text" placeholder="Last name" bind:value={booking.lastName} required />
  </div>

  <div>
    <label for="email">Email</label>
    <input id="email" type="email" placeholder="Provide a contact email" bind:value={booking.email} required />
  </div>

  <div>
    <label for="subject">Subject</label>
    <input id="subject" type="text" placeholder="Suggest a meeting subject" bind:value={booking.subject} required />
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

  <button type="submit" class="push primary" disabled={!canSubmit}>Book</button>
</form>

<style>
  h1 {
    font-size: 1.3rem;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 1.5em;
  }

  div {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
  }

  label {
    font-size: 0.8rem;
    font-weight: bold;
    letter-spacing: 0.05em;
  }

  input {
    padding: 0.5em;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    font-size: 0.9rem;

    &:focus {
      outline: none;
      border-color: var(--accent-color);
    }

    &::placeholder {
      opacity: 0.5;
    }
  }

  button {
    margin-top: 1rem;
    letter-spacing: 0.06em;
  }

  .error {
    font-size: 0.8rem;
    color: var(--error-text-color);
    line-height: 1.3;
    letter-spacing: 0.02em;
  }
</style>
