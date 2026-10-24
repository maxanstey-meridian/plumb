<script setup lang="ts">
// the formatter never wraps a comment, so this one is wrapped by hand
const answer = 42;
</script>

<template>
  <!-- the formatter never wraps a comment, so this one is wrapped by hand -->
  <p>{{ answer }}</p>
</template>
