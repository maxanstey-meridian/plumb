<script setup lang="ts">
// import type is exempt — a DTO type is not a client call (contract §11.9 v8)
import type { NoteDto } from "@acme/contracts";
defineProps<{ note: NoteDto }>();
</script>
