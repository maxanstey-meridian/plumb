<script setup lang="ts">
import { useSuperAuth } from "../composables/useSuperAuth";
const auth = useSuperAuth();
</script>
<template><button @click="auth.login()">login</button></template>
