<script setup lang="ts">
// the formatter keeps code to the line width but it never wraps a comment, so this one runs on well past it
const answer = 42;
</script>

<template>
  <!-- the formatter keeps code to the line width but it never wraps a comment, so this one runs on well past it -->
  <p>{{ answer }}</p>
</template>
