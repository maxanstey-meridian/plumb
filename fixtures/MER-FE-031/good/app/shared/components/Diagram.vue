<script setup lang="ts">
import { midpoint } from "~/shared/logic/geometry";
const centre = midpoint(0, 10);
</script>
<template><svg :data-centre="centre" /></template>
