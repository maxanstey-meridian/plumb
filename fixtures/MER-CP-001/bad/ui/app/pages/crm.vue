<script setup lang="ts">
import { useCrmDestination } from "./crm/composables/useCrmDestination";

const { destination, load } = useCrmDestination();
await load();
const settings = `/settings/integrations/acme-crm`;
const isCrm = () => destination.value?.integrationId === "acme-crm";
const isConnector = () => destination.value?.connectorId === "acme-connector";
const isWebhook = () => destination.value?.handlerId === "acme-webhook";
</script>

<template>
  <a v-if="isCrm()" :href="settings">Settings</a>
  <NuxtLink to="/settings/integrations/acme-crm">Open</NuxtLink>
  <span v-if="destination?.integrationId === 'acme-crm'">CRM</span>
  <span v-if="isConnector()">Connector</span>
  <span v-if="isWebhook()">Webhook</span>
</template>
