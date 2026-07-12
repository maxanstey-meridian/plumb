<script setup lang="ts">
import { useProfile } from "../composables/useProfile";
const profile = useProfile();
</script>
<template><button @click="profile.load()">profile</button></template>
