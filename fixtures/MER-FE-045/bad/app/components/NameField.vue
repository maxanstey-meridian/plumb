<script setup lang="ts">
const name = defineModel<string>({ required: true });
defineProps<{ hint: string | null }>();
</script>

<template>
  <input :value="name" @input="name = ($event.target as HTMLInputElement).value" />
  <p>{{ hint!.trim() }}</p>
</template>
