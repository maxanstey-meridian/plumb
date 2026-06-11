<script setup lang="ts">
import { useClock } from "~/shared/composables/use-clock";
const clock = useClock();
</script>
<template><div>{{ clock.now() }}</div></template>
