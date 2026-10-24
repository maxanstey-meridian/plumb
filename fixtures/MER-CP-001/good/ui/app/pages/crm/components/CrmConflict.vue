<script setup lang="ts">
import AcmeCrmPanel from "./acme-crm/AcmeCrmPanel.vue";
</script>

<template>
  <section class="export" icon="export" subject="export" noun="export" title="export" data-testid="export">
    <AcmeCrmPanel :noun="'export'" :subject="`export`" :type-label="'export'" />
    <span id="export">{{ 'export' }}</span>
    <button type="button" :title="'Choose import/export'">Export</button>
  </section>
</template>
