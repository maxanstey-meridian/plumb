<script setup lang="ts">
import { useRivetAuth } from "../composables/useRivetAuth";
const auth = useRivetAuth();
</script>
<template><button @click="auth.login()">login</button></template>
