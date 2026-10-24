<script setup lang="ts">
const route = useRoute();
</script>

<template>
  <h1>{{ route.params.suite as string }}</h1>
</template>
