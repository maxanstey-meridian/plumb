<script setup lang="ts">
import AcmeCrmPanel from "./acme-crm/AcmeCrmPanel.vue";

defineProps<{ active: boolean }>();
</script>

<template>
  <section class="export" title="export" data-testid="export">
    <AcmeCrmPanel noun="export" subject="export" type-label="export" />
    <AcmeCrmPanel :noun="'export'" :subject="`export`" :type-label="'export'" />
    <span id="export">{{ 'export' }}</span>
    <button type="button" :title="'Choose import/export'">Export</button>
    <span data-test-id="export" :data-qa-id="'export'" />
    <NuxtLink :to="{ name: 'export' }">Export</NuxtLink>
    <span :class="{ export: active }" />
    <span :class="{ 'export': active }" />
  </section>
</template>
