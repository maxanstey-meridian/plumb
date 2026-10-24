<script setup lang="ts">
import { useCrmDestination } from "./composables/useCrmDestination";

const { destination, load } = useCrmDestination();
await load();
const settings = `/settings/integrations/acme-crm`;
const isCrm = () => destination.value?.integrationId === "acme-crm";
const isConnector = () => destination.value?.connectorId === "acme-connector";
const isWebhook = () => destination.value?.handlerId === "acme-webhook";
type Kind = "acme-crm";
type Route = `acme-crm/${string}`;
const isKind = (kind: Kind | null) => kind === "acme-crm";
const status = await $fetch("/api/integrations/acme-crm/status");
const probe = "acme-probe";
type Panel = "acmepanel";
const panels: Record<Panel, string> = { acmepanel: "Panel" };
const route: Route | null = null;
</script>

<template>
  <a v-if="isCrm()" :href="settings">Settings</a>
  <NuxtLink to="/settings/integrations/acme-crm">Open</NuxtLink>
  <span v-if="destination?.integrationId === 'acme-crm'">CRM</span>
  <span v-if="isConnector()">Connector</span>
  <span v-if="isWebhook()">Webhook</span>
  <span :data-kind="isKind(null)" :data-status="status" :data-probe="probe" :data-panels="panels.acmepanel" :data-route="route" />
</template>
