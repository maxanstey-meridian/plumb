<template>
  <NuxtLink to="/settings/integrations/acme-crm">Settings</NuxtLink>
  <span data-kind="acme-connector" handler-id="acme-webhook" />
  <span :handler-id="'acme-webhook'" :data-kind="`acme-crm`" />
  <IntegrationCard :params="{ kind: 'acme-crm' }" />
  <IntegrationCard type="acme-crm" />
  <span v-bind="{ handlerId: 'acme-webhook' }" />
  <FieldEditor type="email" />
  <IntegrationCard v-bind="{ type: 'acme-crm' }" />
  <span v-bind="{ to: 'export' }" />
  <span v-bind="{ meta: { handlerId: 'acme-webhook' } }" />
  <NuxtLink to="text/acme-crm">CRM</NuxtLink>
  <NuxtLink :href="'text/acme-connector'">Connector</NuxtLink>
  <span v-bind="active ? { to: 'text/acme-webhook' } : {}" />
  <NuxtLink :to="{ path: 'text/acme-webhook' }">Webhook</NuxtLink>
  <span v-bind="{ to: { path: 'text/acme-probe' } }" />
  <NuxtLink :to="`text/acme-crm${tab}`">CRM</NuxtLink>
  <a v-bind="{ href: 'text/acme-connector' }">Connector</a>
  <NuxtLink :to="{ name: 'crm', params: { integration: 'acme-crm' } }">CRM</NuxtLink>
  <NuxtLink :to="{ name: 'crm', query: { connector: 'acme-connector' } }">Connector</NuxtLink>
  <NuxtLink to="/crm?integration=acme-crm">CRM</NuxtLink>
  <a :href="'/crm?tab=1&handler=acme-webhook'">Webhook</a>
  <button type="button" @click="$router.push('acme-probe')">Probe</button>
  <span v-bind="{ to: { name: 'crm', params: { slug: ['acme-connector'] } } }" />
  <NuxtLink to="?integration=acme-crm">CRM</NuxtLink>
  <NuxtLink :to="{ path: '/crm/acme-connector', hash: '#acme-crm' }">Connector</NuxtLink>
  <a href="/crm?handler=acme-webhook#acme-crm">Webhook</a>
  <button type="button" @click="open('acme-probe')">Probe</button>
  <NuxtLink :to="`?tab=${tab}&integration=acme-crm`">CRM</NuxtLink>
  <a href="#/crm/acme-crm">CRM</a>
</template>

<script setup lang="ts">
const { push: open } = useRouter();
</script>
