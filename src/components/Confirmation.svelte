<script lang="ts">
  export let onDismiss: () => void
  export let onConfirm: () => void
</script>

<div class="root">
  Cancel the meeting?

  <div class="buttons">
    <button class="push primary" on:click={onDismiss}>Dismiss</button>
    <button class="push danger" on:click={onConfirm}>Confirm</button>
  </div>
</div>

<style>
  .root {
    display: flex;
    flex-direction: column;
    gap: 1.5em;
  }

  .buttons {
    display: flex;
    flex-direction: row;
    gap: 1em;
  }

  button {
    flex: 1;
  }
</style>
