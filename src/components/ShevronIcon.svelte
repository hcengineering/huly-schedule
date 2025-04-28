<script lang="ts">
  export let direction: 'left' | 'right'
  export let size: number = 20
</script>

{#if direction === 'left'}
  <svg width={size} height={size} viewBox="0 0 20 20">
    <path d="m4 10 10 10 2-2-8-8 8-8-2-2z"/>
  </svg>
{:else}
  <svg width={size} height={size} viewBox="0 0 20 20">
    <path d="m16 10-10 10-2-2 8-8-8-8 2-2z"/>
  </svg>
{/if}
