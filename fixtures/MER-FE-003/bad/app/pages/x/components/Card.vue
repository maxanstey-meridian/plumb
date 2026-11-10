<script setup lang="ts">
// a subpath of the contracts package is still the client
import { client } from "@acme/contracts/client";
const load = () => client.GET("/api/forms");
</script>
