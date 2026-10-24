<template>
  <NuxtLink to="/settings/integrations/acme-crm">Settings</NuxtLink>
  <span data-kind="acme-connector" handler-id="acme-webhook" />
  <span :handler-id="'acme-webhook'" :data-kind="`acme-crm`" />
  <IntegrationCard :params="{ kind: 'acme-crm' }" />
  <IntegrationCard type="acme-crm" />
  <span v-bind="{ handlerId: 'acme-webhook' }" />
  <FieldEditor type="email" />
  <IntegrationCard v-bind="{ type: 'acme-crm' }" />
</template>
