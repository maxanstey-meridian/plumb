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
    <svg><linearGradient id="export" /></svg>
    <UInput type="email" />
    <UButton :type="'email'" />
    <UInput id="export" />
    <UFormField :id="'export'" />
    <span v-bind="{ id: 'export' }" />
    <UInput v-bind="{ id: 'export', type: 'email' }" />
    <span v-bind="{ type: 'export' }" />
    <span v-bind="active ? { id: 'export' } : {}" />
    <span v-bind="$attrs ?? { id: 'export' }" />
    <input v-bind="active ? { type: 'email' } : {}">
    <AcmeCrmPanel v-on="{ 'export': () => {} }" />
    <AcmeCrmPanel v-bind="{ 'export': true, ['csv']: active }" />
  </section>
</template>
