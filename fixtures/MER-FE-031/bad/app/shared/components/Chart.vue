<script setup lang="ts">
import { scale } from "~/shared/logic/scale";
const height = scale(1, 10);
</script>
<template><svg :height="height" /></template>
