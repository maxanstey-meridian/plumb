<script setup lang="ts">
const props = defineProps<{ integration: { integrationId: string } }>();
const settings = `/settings/integrations/acme-crm`;
const isCrm = () => props.integration.integrationId === "acme-crm";
</script>

<template>
  <a v-if="isCrm()" :href="settings">Settings</a>
  <NuxtLink to="/settings/integrations/acme-crm">Open</NuxtLink>
  <span v-if="integration.integrationId === 'acme-crm'">CRM</span>
</template>
