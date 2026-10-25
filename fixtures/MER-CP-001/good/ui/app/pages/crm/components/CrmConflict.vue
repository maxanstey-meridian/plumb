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
    <AcmeCrmPanel v-on="active ? { 'acme-crm': () => {} } : {}" />
    <AcmeCrmPanel v-bind="{ email: 'export' }" />
    <AcmeCrmPanel :meta="{ path: 'export' }" />
    <AcmeCrmPanel :logos="{ 'acme-crm': '/logos/acme.svg' }" />
    <AcmeCrmPanel :labels="{ 'acme-crm': $t('crm.title') }" />
    <span :title="'format=export'" />
    <a href="#export">Jump to export</a>
    <NuxtLink :to="{ path: '/crm', hash: '#export' }">Export</NuxtLink>
    <svg><use href="#csv" /></svg>
    <svg><use :href="'#export'" /></svg>
    <Teleport to="#export"><span>Export</span></Teleport>
  </section>
</template>
