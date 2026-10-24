<script setup lang="ts">
const name = defineModel<string>({ required: true });
defineProps<{ hint: string | null }>();
const sizes = ["s", "m"] as const;
</script>

<template>
  <input v-model="name" />
  <p v-if="hint">{{ hint.trim() }}</p>
  <span v-for="size in sizes" :key="size">{{ size }}</span>
  <SizePicker :options="['s', 'm'] as const satisfies readonly string[]" />
</template>
