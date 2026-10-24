<script setup lang="ts">
import AcmeCrmPanel from "~/components/acme-crm/AcmeCrmPanel.vue";

const { data: destination } = await useFetch<{ integrationId: string | null }>("/api/crm/destination");
const settings = computed(() =>
  destination.value?.integrationId ? `/settings/integrations/${destination.value.integrationId}` : null,
);
const label = "Acme CRM";
const legacy = "/settings/acme-crm-legacy";
const key = "acme-key";
const secret = "acme-secret";
const fixture = "acme-fixture";
</script>

<template>
  <a v-if="settings" :href="settings">{{ label }}</a>
  <NuxtLink :to="legacy">Legacy</NuxtLink>
  <AcmeCrmPanel :data-key="key" :data-secret="secret" :data-fixture="fixture" />
  <span class="acme">acme</span>
</template>
