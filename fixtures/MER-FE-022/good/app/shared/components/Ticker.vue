<script setup lang="ts">
import { useTicker } from "~/shared/composables/use-ticker";
const ticker = useTicker();
</script>
<template><span>{{ ticker.tick() }}</span></template>
