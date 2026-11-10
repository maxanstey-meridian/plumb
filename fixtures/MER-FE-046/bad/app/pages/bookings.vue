<script setup lang="ts">
import { injectBooking as useBooking } from "~/features/booking";

const booking = useBooking();
</script>

<template>
  <button type="button" @click="booking.book('a')">Book</button>
</template>
