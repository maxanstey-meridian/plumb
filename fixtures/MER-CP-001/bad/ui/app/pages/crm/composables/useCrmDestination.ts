import { ref } from "vue";
import { crmClient, type CrmDestinationDto } from "~/generated/client";

export const useCrmDestination = () => {
  const destination = ref<CrmDestinationDto | null>(null);
  const load = async () => {
    destination.value = await crmClient.getDestination();
  };
  return { destination, load };
};
