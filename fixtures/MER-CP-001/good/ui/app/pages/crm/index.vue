<script setup lang="ts">
import AcmeCrmPanel from "./components/acme-crm/AcmeCrmPanel.vue";
import { useCrmDestination } from "./composables/useCrmDestination";
import { api } from "~/generated/client";

const { destination, load } = useCrmDestination();
await load();
const settings = computed(() =>
  destination.value?.integrationId ? `/settings/integrations/${destination.value.integrationId}` : null,
);
const label = "Acme CRM";
const legacy = "/settings/acme-crm-legacy";
const key = "acme-key";
const secret = "acme-secret";
const fixture = "acme-fixture";
type Kind = "acme-crm" | "acme-other";
const kinds: readonly Kind[] = [];
const { data: status } = await api.GET("/api/integrations/acme-crm/status");
const lookup = "acme-lookup";
</script>

<template>
  <NuxtLink v-if="settings" :to="settings">{{ label }}</NuxtLink>
  <NuxtLink :to="legacy">Legacy</NuxtLink>
  <AcmeCrmPanel :data-key="key" :data-secret="secret" :data-fixture="fixture" />
  <span class="acme" :data-kinds="kinds.join()" :data-status="status?.connected" :data-lookup="lookup">acme</span>
</template>
