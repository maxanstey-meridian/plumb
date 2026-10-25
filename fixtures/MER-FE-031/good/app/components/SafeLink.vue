<script setup lang="ts">
import { isSafeHref } from "~/shared/logic/href";
const props = defineProps<{ href: string }>();
</script>
<template><a v-if="isSafeHref(props.href)" :href="props.href"><slot /></a></template>
