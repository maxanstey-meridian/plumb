<script setup lang="ts">
import * as session from "./features/session";

session.provideSession({ userId: "u1" });
installTheme({ dark: false });
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
