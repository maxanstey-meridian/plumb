<script setup lang="ts">
const props = defineProps<{ destination: { integrationId: string | null } }>();
const settings = computed(() =>
  props.destination.integrationId ? `/settings/integrations/${props.destination.integrationId}` : null,
);
const label = "Acme CRM";
</script>

<template>
  <a v-if="settings" :href="settings">{{ label }}</a>
  <span class="acme">acme</span>
</template>
