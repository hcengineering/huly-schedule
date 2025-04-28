<script lang="ts">
  import Modal, { type Component, bind } from './Modal.svelte'
  import Confirmation from './Confirmation.svelte'
  import { formatLocalTimezone, formatTimeslot } from '../scripts/client/utils'
  import type { Timeslot, UIContext } from '../scripts/types'
  import { cancelMeeting } from '../scripts/client/api'

  export let context: UIContext
  export let timeslot: Timeslot
  export let eventId: string
  export let email: string
  export let ical: string | undefined
  export let onCanceled: () => void

  let loading = false
  let errorKind: 'not-found' | 'unknown' | undefined
  let modal: Component | undefined

  $: icalUrl = ical !== undefined && ical.length > 0
    ? `data:text/calendar;charset=utf-8;base64,${btoa(unescape(encodeURIComponent(ical)))}`
    : undefined

  function handleCancel() {
    modal = bind(Confirmation, {
      onDismiss: () => {
        modal = undefined
      },
      onConfirm: () => {
        modal = undefined
        loading = true
        cancelMeeting(context, eventId, email)
          .then((res) => {
            loading = false
            errorKind = undefined
            if (res === 'not-found') {
              errorKind = 'not-found'
            } else if (res === 'error') {
              errorKind = 'unknown'
            } else {
              onCanceled()
            }
          })
          .catch((err) => {
            loading = false
            console.error('Failed to book meeting', err)
          })
      }
    })
  }
</script>

<div class="root">
  <Modal
    closeButton={false}
    closeOnOuterClick={true}
    closeOnEsc={false}
    styleWindow={{
      width: '20rem',
      padding: '1.2rem',
      borderRadius: '0.75rem',
      backgroundColor: 'var(--bg-color)'
    }}
    show={modal}
  />

  <h1>{context.schedule.title}</h1>

  <div class="block">
    <span>{@html formatTimeslot(timeslot)}</span>
    <span style="opacity: 0.4">{formatLocalTimezone()}</span>
  </div>

  <div class="block">
    <h2>Meeting booked</h2>
    <span>Invitation sent to <a href={`mailto:${email}`}>{email}</a></span>
    {#if icalUrl !== undefined}
      <a href={icalUrl} title="invite.ics" download="invite.ics" class="download">Download invite</a>
    {/if}
  </div>

  <div class="block">
    <h2>Changed your mind?</h2>

    {#if errorKind === 'not-found'}
      <div class="error">
        Meeting not found for this time.
      </div>
    {:else if errorKind === 'unknown'}
      <div class="error">
        An error occurred while canceling the meeting.
      </div>
    {/if}

    <button class="push danger" disabled={loading} on:click={handleCancel}>Cancel booking</button>
  </div>
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

  .error {
    font-size: 0.8rem;
    color: var(--error-text-color);
    line-height: 1.3;
    letter-spacing: 0.02em;
    margin-bottom: 1rem;
  }

  .download {
    color: var(--accent-color);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
</style>
