<script setup lang="ts">
import { injectAuth } from "../ports/auth";
const auth = injectAuth();
</script>
<template><button @click="auth.login()">login</button></template>
