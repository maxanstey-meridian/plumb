<script setup lang="ts">
import { provideAuth } from "../../app/pages/x/ports/auth";
provideAuth(createFakeAuth());
</script>
