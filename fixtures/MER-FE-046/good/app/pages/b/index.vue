<script setup lang="ts">
import { provideAuth } from "./ports/auth";

provideAuth({ signOut: () => {} });
</script>

<template>
  <div />
</template>
