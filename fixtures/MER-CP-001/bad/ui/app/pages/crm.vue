<script setup lang="ts">
const { data: integration } = await useFetch<{ integrationId: string; connectorId: string }>("/api/crm/integration");
const settings = `/settings/integrations/acme-crm`;
const isCrm = () => integration.value?.integrationId === "acme-crm";
const isConnector = () => integration.value?.connectorId === "acme-connector";
</script>

<template>
  <a v-if="isCrm()" :href="settings">Settings</a>
  <NuxtLink to="/settings/integrations/acme-crm">Open</NuxtLink>
  <span v-if="integration?.integrationId === 'acme-crm'">CRM</span>
  <span v-if="isConnector()">Connector</span>
</template>
