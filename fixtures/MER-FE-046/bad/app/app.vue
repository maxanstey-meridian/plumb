<script setup lang="ts">
import { provideRooms } from "./features/rooms";

provideRooms({ list: async () => [] });
</script>

<template>
  <NuxtPage />
</template>
