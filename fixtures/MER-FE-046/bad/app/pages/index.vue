<script setup lang="ts">
import * as clock from "../features/clock";

const now = clock.currentClock().now();
</script>

<template>
  <p>{{ now }}</p>
</template>
