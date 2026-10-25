<script setup lang="ts">
defineProps<{
  noun?: string; subject?: string; typeLabel?: string;
  meta?: { path: string }; logos?: Record<string, string>; labels?: Record<string, string>;
}>();
</script>

<template>
  <section>
    <h2>{{ subject }}</h2>
    <p>{{ typeLabel }}: {{ noun }}</p>
    <slot />
  </section>
</template>
