<script setup lang="ts">
import { currentTheme } from "../features/theme";

const theme = currentTheme();
</script>

<template>
  <span>{{ theme.dark ? "dark" : "light" }}</span>
</template>
