<script setup lang="ts">
// the formatter never wraps a comment, so this one is wrapped by hand
// https://example.com/a/very/long/path/that/cannot/be/broken/anywhere/because/it/is/one/single/token/of/text/and/goes/on
const answer = 42;
</script>

<template>
  <!-- the formatter never wraps a comment, so this one is wrapped by hand -->
  <!-- https://example.com/a/very/long/path/that/cannot/be/broken/anywhere/because/it/is/one/single/token/of/text/and/on/and/on -->
  <!-- eslint-disable-next-line vue/no-v-html -- a template directive is read from its one line too, so its reason can't wrap -->
  <p v-html="answer" />
  <p>{{ answer }}</p> <!-- a template comment after markup is out of scope: MER-TO-015 only measures comment-only lines, so it passes -->
</template>
