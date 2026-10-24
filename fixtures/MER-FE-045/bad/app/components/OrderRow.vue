<script setup lang="ts">
const props = defineProps<{ order: { id: string; total: unknown; key: string | null; lines: unknown } }>();
const note = defineModel<string>({ required: true });
</script>

<template>
  <tr :[props.order.key!]="1">
    <td>{{ props.order.total as unknown as number }}</td>
    <td>
      <input
        :value="note"
        @input="
          note = (
            $event.target as HTMLInputElement
          ).value
        "
      />
    </td>
    <td
      v-for="line in
        (props.order.lines as string[])"
      :key="line"
    >{{ line }}</td>
  </tr>
</template>
