<script setup lang="ts">
import { injectSession as useCurrentSession } from "~/features/session";

const session = useCurrentSession();
</script>

<template>
  <header>{{ session.userId }}</header>
  <slot />
</template>
