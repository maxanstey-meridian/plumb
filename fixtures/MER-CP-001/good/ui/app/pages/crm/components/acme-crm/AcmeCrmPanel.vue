<script setup lang="ts">
defineProps<{ noun: string; subject: string; typeLabel: string }>();
</script>

<template>
  <section>
    <h2>{{ subject }}</h2>
    <p>{{ typeLabel }}: {{ noun }}</p>
    <slot />
  </section>
</template>
