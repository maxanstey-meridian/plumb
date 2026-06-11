<script setup lang="ts">
// v2 shape: bare workspace contracts-package import from a component
import { client } from "@acme/contracts";
const load = () => client.GET("/api/notes");
</script>
