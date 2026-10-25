<script setup lang="ts">
import { usePulse } from "~/shared/composables/use-pulse";
const pulse = usePulse();
</script>
<template><span>{{ pulse.beat() }}</span></template>
