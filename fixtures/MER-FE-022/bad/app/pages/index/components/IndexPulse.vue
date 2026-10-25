<script setup lang="ts">
import Pulse from "~/shared/components/Pulse.vue";
import { usePulse } from "~/shared/composables/use-pulse";
const pulse = usePulse();
</script>
<template><Pulse :title="String(pulse.beat())" /></template>
